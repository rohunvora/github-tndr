import { z } from 'zod';

// ============ REPO STATE ============

export type RepoState =
  | 'unanalyzed'  // Never looked at
  | 'analyzing'   // Job in flight
  | 'dead'        // Killed by user
  | 'no_core'     // Analyzed, no clear core found
  | 'has_core'    // Core identified, needs work
  | 'ready'       // Ready to ship (deploy green, tweet drafted)
  | 'shipped';    // Launched

export type Verdict = 'ship' | 'cut_to_core' | 'no_core' | 'dead';

// ============ CORE ANALYSIS (LLM Output) ============

export const CoreAnalysisSchema = z.object({
  one_liner: z.string().max(140).describe('One sentence description, max 140 chars'),
  what_it_does: z.string().describe('2-3 sentences explaining what this project does'),
  has_core: z.boolean().describe('Does this project have a clear, valuable core?'),
  core_value: z.string().nullable().describe('The one thing that is novel or valuable (null if no core)'),
  why_core: z.string().nullable().describe('Why this is the core value (null if no core)'),
  keep: z.array(z.string()).describe('Files/directories to keep'),
  cut: z.array(z.string()).describe('Files/directories to remove (bloat)'),
  verdict: z.enum(['ship', 'cut_to_core', 'no_core', 'dead']).describe('The honest verdict'),
  verdict_reason: z.string().describe('Why this verdict'),
  tweet_draft: z.string().max(280).nullable().describe('Draft tweet if ready to ship (null otherwise)'),
});

export type CoreAnalysis = z.infer<typeof CoreAnalysisSchema>;

// ============ TRACKED REPO ============

export interface TrackedRepo {
  id: string;                      // owner/repo
  name: string;                    // repo name
  owner: string;                   // owner/org
  state: RepoState;

  // Latest analysis
  analysis: CoreAnalysis | null;
  analyzed_at: string | null;

  // Pending action (waiting for user to push changes)
  pending_action: 'cut_to_core' | 'ship' | null;
  pending_since: string | null;

  // Telegram context (for reply-to threading)
  last_message_id: number | null;

  // Activity
  last_push_at: string | null;
  killed_at: string | null;
  shipped_at: string | null;
}

// ============ COMMIT SIGNALS ============

export interface CommitSignals {
  velocity: 'active' | 'stale';           // Based on commit frequency
  coherence: 'focused' | 'chaotic';       // Based on commit message patterns
  days_since_last: number;                // Days since last commit
}

// ============ CURSOR PROMPT ============

export interface CursorPrompt {
  repo: string;
  goal: string;
  delete_files: string[];
  modify_instructions: string;
  acceptance: string;
}

// ============ SHIP PACKAGE ============

export interface ShipPackage {
  repo: string;
  deploy_url: string | null;
  screenshot_url: string | null;
  one_liner: string;
  tweet: string;
}

// ============ VALIDATION HELPERS ============

/**
 * Validate that keep and cut lists are disjoint
 */
export function validateKeepCutDisjoint(analysis: CoreAnalysis): { valid: boolean; overlap: string[] } {
  const keepSet = new Set(analysis.keep);
  const cutSet = new Set(analysis.cut);
  const overlap = [...keepSet].filter(f => cutSet.has(f));
  return { valid: overlap.length === 0, overlap };
}

/**
 * Validate logical consistency of verdict
 */
export function validateVerdictConsistency(analysis: CoreAnalysis): { valid: boolean; error: string | null } {
  // If no core, verdict must be no_core or dead
  if (!analysis.has_core && !['no_core', 'dead'].includes(analysis.verdict)) {
    return { valid: false, error: `No core but verdict is ${analysis.verdict}` };
  }

  // If ship verdict, must have core
  if (analysis.verdict === 'ship' && !analysis.has_core) {
    return { valid: false, error: 'Ship verdict requires has_core = true' };
  }

  // If ship verdict, must have core_value
  if (analysis.verdict === 'ship' && !analysis.core_value) {
    return { valid: false, error: 'Ship verdict requires core_value' };
  }

  // If ship verdict, should have tweet_draft
  if (analysis.verdict === 'ship' && !analysis.tweet_draft) {
    return { valid: false, error: 'Ship verdict should have tweet_draft' };
  }

  return { valid: true, error: null };
}

/**
 * Validate file paths exist in the provided file tree
 */
export function validateFilePaths(
  analysis: CoreAnalysis,
  fileTree: string[]
): { valid: boolean; invalidPaths: string[] } {
  const treeSet = new Set(fileTree);
  const allPaths = [...analysis.keep, ...analysis.cut];
  
  // For validation, we check if paths are prefixes of actual files
  // e.g., "components/NewsFeed" should match "components/NewsFeed.tsx"
  const invalidPaths = allPaths.filter(path => {
    // Check exact match
    if (treeSet.has(path)) return false;
    // Check if any file starts with this path (for directories)
    return !fileTree.some(f => f.startsWith(path + '/') || f.startsWith(path + '.'));
  });

  return { valid: invalidPaths.length === 0, invalidPaths };
}

/**
 * Run all validations on an analysis
 */
export function validateAnalysis(
  analysis: CoreAnalysis,
  fileTree: string[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check keep/cut disjoint
  const disjointCheck = validateKeepCutDisjoint(analysis);
  if (!disjointCheck.valid) {
    errors.push(`Files in both keep and cut: ${disjointCheck.overlap.join(', ')}`);
  }

  // Check verdict consistency
  const verdictCheck = validateVerdictConsistency(analysis);
  if (!verdictCheck.valid) {
    errors.push(verdictCheck.error!);
  }

  // Check file paths (soft check - warn but don't fail)
  const pathCheck = validateFilePaths(analysis, fileTree);
  if (!pathCheck.valid) {
    console.warn(`Warning: Invalid file paths in analysis: ${pathCheck.invalidPaths.join(', ')}`);
  }

  // Check tweet length
  if (analysis.tweet_draft && analysis.tweet_draft.length > 280) {
    errors.push(`Tweet too long: ${analysis.tweet_draft.length} chars`);
  }

  return { valid: errors.length === 0, errors };
}
