/**
 * Project Selector
 * Picks the best projects to work on based on momentum and context
 */

import { stateManager } from '../../core/state.js';
import { GitHubClient } from '../../core/github.js';
import type { TrackedRepo } from '../../core/types.js';
import { info } from '../../core/logger.js';

export interface ProjectCandidate {
  repo: TrackedRepo;
  score: number;
  reason: string;
  momentum: 'high' | 'medium' | 'low';
  daysSinceCommit: number;
}

/**
 * Get sorted list of project candidates for the carousel
 */
export async function getProjectCandidates(): Promise<ProjectCandidate[]> {
  info('next.selector', 'Getting candidates');

  // Get active repos (not dead/shipped)
  const repos = await stateManager.getActiveRepos();
  
  if (repos.length === 0) {
    return [];
  }

  const github = new GitHubClient(process.env.GITHUB_TOKEN!);
  const candidates: ProjectCandidate[] = [];

  for (const repo of repos) {
    // Skip repos without analysis
    if (!repo.analysis) continue;

    // Get commit signals
    let daysSinceCommit = 999;
    try {
      const signals = await github.getCommitSignals(repo.owner, repo.name);
      daysSinceCommit = signals.days_since_last;
    } catch {
      // Use last_push_at if available
      if (repo.last_push_at) {
        daysSinceCommit = Math.floor((Date.now() - new Date(repo.last_push_at).getTime()) / 86400000);
      }
    }

    // Calculate score
    const { score, reason, momentum } = calculateScore(repo, daysSinceCommit);

    candidates.push({
      repo,
      score,
      reason,
      momentum,
      daysSinceCommit,
    });
  }

  // Sort by score (highest first)
  candidates.sort((a, b) => b.score - a.score);

  info('next.selector', 'Candidates ready', { count: candidates.length });
  return candidates;
}

function calculateScore(repo: TrackedRepo, daysSinceCommit: number): {
  score: number;
  reason: string;
  momentum: 'high' | 'medium' | 'low';
} {
  let score = 0;
  const reasons: string[] = [];
  let momentum: 'high' | 'medium' | 'low' = 'low';

  const a = repo.analysis!;

  // Recency bonus (max 40 points)
  if (daysSinceCommit <= 1) {
    score += 40;
    reasons.push('Active today');
    momentum = 'high';
  } else if (daysSinceCommit <= 3) {
    score += 30;
    reasons.push('Active this week');
    momentum = 'high';
  } else if (daysSinceCommit <= 7) {
    score += 20;
    reasons.push('Recent activity');
    momentum = 'medium';
  } else if (daysSinceCommit <= 14) {
    score += 10;
    momentum = 'medium';
  }

  // Verdict bonus (max 30 points)
  if (a.verdict === 'ship') {
    score += 30;
    reasons.push('Ready to ship');
  } else if (a.verdict === 'cut_to_core') {
    score += 20;
    reasons.push('Has clear core');
  }

  // Pride bonus (max 20 points)
  if (a.pride_level === 'proud') {
    score += 20;
    reasons.push('Proud of it');
  } else if (a.pride_level === 'comfortable') {
    score += 10;
  }

  // Blocker penalty
  if (a.pride_blockers && a.pride_blockers.length > 0) {
    score -= a.pride_blockers.length * 5;
  }

  // Staleness penalty
  if (daysSinceCommit > 30) {
    score -= 20;
    if (momentum !== 'high') momentum = 'low';
  }

  const reason = reasons.length > 0 ? reasons[0] : 'Available to work on';

  return { score, reason, momentum };
}

