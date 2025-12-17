// Push Analyzer - Determines if a push is "meaningful" for notifications
// "Meaningful" is deterministic: cut list files deleted, README changed, blockers resolved

import { CoreAnalysis } from './core-types.js';
import { info } from './logger.js';

interface Commit {
  id: string;
  message: string;
  added: string[];
  removed: string[];
  modified: string[];
}

export interface PushAnalysisResult {
  meaningful: boolean;
  cutFilesDeleted: string[];
  cutRemaining: number | null;
  readmeChanged: boolean;
  blockersResolved: string[];
  blockerCountChange: { before: number; after: number } | null;
}

/**
 * Analyze a push to determine if it's "meaningful"
 * 
 * Meaningful = any of:
 * - Files from cut list were deleted
 * - README.md was changed
 * - Files mentioned in blockers were changed/deleted
 * 
 * Everything else: silence
 */
export function analyzePush(commits: Commit[], analysis: CoreAnalysis): PushAnalysisResult {
  const result: PushAnalysisResult = {
    meaningful: false,
    cutFilesDeleted: [],
    cutRemaining: null,
    readmeChanged: false,
    blockersResolved: [],
    blockerCountChange: null,
  };
  
  // Collect all file changes from commits
  const allRemoved = new Set<string>();
  const allModified = new Set<string>();
  const allAdded = new Set<string>();
  
  for (const commit of commits) {
    commit.removed.forEach(f => allRemoved.add(f));
    commit.modified.forEach(f => allModified.add(f));
    commit.added.forEach(f => allAdded.add(f));
  }
  
  info('push-analyzer', 'Files changed', {
    removed: allRemoved.size,
    modified: allModified.size,
    added: allAdded.size,
  });
  
  // Check for cut list files deleted
  const cutSet = new Set(analysis.cut || []);
  for (const file of allRemoved) {
    // Check if file or its directory is in cut list
    if (cutSet.has(file)) {
      result.cutFilesDeleted.push(file);
    } else {
      // Check if a directory containing this file is in cut list
      for (const cutPath of cutSet) {
        if (file.startsWith(cutPath + '/') || cutPath.startsWith(file + '/')) {
          result.cutFilesDeleted.push(file);
          break;
        }
      }
    }
  }
  
  if (result.cutFilesDeleted.length > 0) {
    result.meaningful = true;
    // Calculate remaining cut files (approximate)
    const cutCount = analysis.cut?.length || 0;
    result.cutRemaining = Math.max(0, cutCount - result.cutFilesDeleted.length);
  }
  
  // Check for README changes
  const readmeVariants = ['README.md', 'readme.md', 'README', 'readme.txt'];
  for (const readme of readmeVariants) {
    if (allModified.has(readme) || allAdded.has(readme)) {
      result.readmeChanged = true;
      result.meaningful = true;
      break;
    }
  }
  
  // Check for blocker-related changes
  const blockers = analysis.pride_blockers || [];
  const blockersBefore = blockers.length;
  
  for (const blocker of blockers) {
    // Extract file/folder references from blocker text
    // e.g., "Archive folder with old code still in repo" -> check for "archive" deletion
    const blockerLower = blocker.toLowerCase();
    
    // Check if blocker mentions a removed file/folder
    for (const removed of allRemoved) {
      const removedLower = removed.toLowerCase();
      // Check if the removed file is mentioned in the blocker
      if (blockerLower.includes(removedLower) || 
          blockerLower.includes(removedLower.split('/')[0])) {
        result.blockersResolved.push(blocker);
        result.meaningful = true;
        break;
      }
    }
    
    // Common patterns in blocker text
    if (blockerLower.includes('archive') && 
        [...allRemoved].some(f => f.toLowerCase().includes('archive'))) {
      if (!result.blockersResolved.includes(blocker)) {
        result.blockersResolved.push(blocker);
        result.meaningful = true;
      }
    }
    
    if (blockerLower.includes('mock') && 
        [...allRemoved].some(f => f.toLowerCase().includes('mock'))) {
      if (!result.blockersResolved.includes(blocker)) {
        result.blockersResolved.push(blocker);
        result.meaningful = true;
      }
    }
  }
  
  // Calculate blocker count change
  if (result.blockersResolved.length > 0) {
    const blockersAfter = blockersBefore - result.blockersResolved.length;
    result.blockerCountChange = {
      before: blockersBefore,
      after: Math.max(0, blockersAfter),
    };
  }
  
  info('push-analyzer', 'Result', {
    meaningful: result.meaningful,
    cutDeleted: result.cutFilesDeleted.length,
    readmeChanged: result.readmeChanged,
    blockersResolved: result.blockersResolved.length,
  });
  
  return result;
}

