/**
 * Scan Skill
 *
 * WRAPPER around lib/tools/scan/ - does NOT duplicate logic.
 * Provides testable skill interface for batch repo scanning.
 *
 * Flow: Fetch recent repos → Analyze each (via repoSkill) → Group by verdict
 */

import type { Skill, SkillContext, SkillResult } from '../_shared/types.js';
import type { TrackedRepo, CoreAnalysis } from '../../core/types.js';
import { GitHubClient } from '../../core/github.js';
import { stateManager } from '../../core/state.js';

// IMPORT from existing modules - DO NOT duplicate
import { repoSkill } from '../repo/index.js';
import {
  formatScanProgress,
  formatScanSummary,
  formatScanTimeout,
  type ScanVerdictCounts,
  type GroupedRepos,
} from '../../tools/scan/format.js';

// Re-export types for convenience
export type { ScanVerdictCounts, GroupedRepos } from '../../tools/scan/format.js';

// ============ INPUT/OUTPUT TYPES ============

export interface ScanSkillInput {
  /** Number of days to look back for recent repos */
  days?: number;
  /** Maximum repos to analyze (for testing) */
  limit?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Callback for progress updates */
  onRepoAnalyzed?: (repo: TrackedRepo, index: number, total: number) => void;
}

export interface ScanSkillOutput {
  /** Repos grouped by verdict */
  groups: GroupedRepos;
  /** Verdict counts */
  verdicts: ScanVerdictCounts;
  /** Total repos found */
  totalFound: number;
  /** Total repos analyzed */
  totalAnalyzed: number;
  /** Number from cache */
  cached: number;
  /** Errors encountered */
  errors: string[];
  /** Whether timeout was hit */
  hitTimeout: boolean;
  /** Formatted summary message */
  summaryMessage: string;
}

// ============ SKILL DEFINITION ============

export const scanSkill: Skill<ScanSkillInput, ScanSkillOutput> = {
  name: 'scan',
  description: 'Batch scan recent GitHub repos and categorize by verdict',
  dependencies: ['github', 'anthropic'],

  progressSteps: [
    'Fetching repos...',
    'Analyzing repos...',
    'Generating summary...',
  ],

  async run(
    input: ScanSkillInput,
    ctx: SkillContext
  ): Promise<SkillResult<ScanSkillOutput>> {
    const {
      days = 10,
      limit,
      timeout = 55000,
      onRepoAnalyzed,
    } = input;

    const startTime = Date.now();

    try {
      // Step 1: Fetch recent repos
      await ctx.onProgress?.('Fetching repos...');

      const github = new GitHubClient(process.env.GITHUB_TOKEN!);
      const repos = await github.getRecentRepos(days);

      if (repos.length === 0) {
        return {
          success: true,
          data: {
            groups: { ship: [], cut: [], no_core: [], dead: [], shipped: [] },
            verdicts: { ship: 0, cut: 0, no_core: 0, dead: 0, shipped: 0 },
            totalFound: 0,
            totalAnalyzed: 0,
            cached: 0,
            errors: [],
            hitTimeout: false,
            summaryMessage: `No repos found in last ${days} days.`,
          },
        };
      }

      const reposToScan = limit ? repos.slice(0, limit) : repos;

      // Step 2: Analyze each repo
      await ctx.onProgress?.('Analyzing repos...', `0/${reposToScan.length}`);

      const analyzed: TrackedRepo[] = [];
      const errors: string[] = [];
      let cached = 0;
      const verdicts: ScanVerdictCounts = { ship: 0, cut: 0, no_core: 0, dead: 0, shipped: 0 };

      const countVerdict = (repo: TrackedRepo) => {
        if (repo.state === 'shipped') verdicts.shipped++;
        else if (repo.analysis?.verdict === 'ship') verdicts.ship++;
        else if (repo.analysis?.verdict === 'cut_to_core') verdicts.cut++;
        else if (repo.analysis?.verdict === 'no_core') verdicts.no_core++;
        else if (repo.analysis?.verdict === 'dead') verdicts.dead++;
      };

      let hitTimeout = false;

      // Process in batches of 5
      for (let i = 0; i < reposToScan.length; i += 5) {
        // Check timeout
        if (Date.now() - startTime > timeout) {
          hitTimeout = true;
          break;
        }

        const batch = reposToScan.slice(i, i + 5);

        await Promise.all(batch.map(async (repo) => {
          const [owner, name] = repo.full_name.split('/');

          try {
            // Check if already tracked
            let tracked = await stateManager.getTrackedRepo(owner, name);

            // Skip shipped/dead
            if (tracked?.state === 'shipped' || tracked?.state === 'dead') {
              cached++;
              countVerdict(tracked);
              analyzed.push(tracked);
              onRepoAnalyzed?.(tracked, analyzed.length, reposToScan.length);
              return;
            }

            // Skip if no new commits
            const hasAnalysis = tracked?.analysis !== null;
            const hasNewCommits = new Date(repo.pushed_at).getTime() >
              (tracked?.analyzed_at ? new Date(tracked.analyzed_at).getTime() : 0);

            if (hasAnalysis && !hasNewCommits && tracked) {
              cached++;
              countVerdict(tracked);
              analyzed.push(tracked);
              onRepoAnalyzed?.(tracked, analyzed.length, reposToScan.length);
              return;
            }

            // Run analysis via repoSkill
            const result = await repoSkill.run({
              owner,
              name,
              forceRefresh: hasNewCommits,
            }, ctx);

            if (result.success && result.data) {
              tracked = result.data.trackedRepo;
              countVerdict(tracked);
              analyzed.push(tracked);
              onRepoAnalyzed?.(tracked, analyzed.length, reposToScan.length);
            } else {
              errors.push(`${name}: ${result.error || 'Unknown error'}`);
            }
          } catch (err) {
            errors.push(`${name}: ${err instanceof Error ? err.message : 'error'}`);
          }
        }));

        // Update progress
        await ctx.onProgress?.('Analyzing repos...', `${analyzed.length}/${reposToScan.length}`);
      }

      // Step 3: Group results
      await ctx.onProgress?.('Generating summary...');

      const groups: GroupedRepos = {
        ship: analyzed.filter(r => r.analysis?.verdict === 'ship'),
        cut: analyzed.filter(r => r.analysis?.verdict === 'cut_to_core'),
        no_core: analyzed.filter(r => r.analysis?.verdict === 'no_core'),
        dead: analyzed.filter(r => r.analysis?.verdict === 'dead'),
        shipped: analyzed.filter(r => r.state === 'shipped'),
      };

      const summaryMessage = hitTimeout
        ? formatScanTimeout(analyzed.length, reposToScan.length, verdicts)
        : formatScanSummary(groups);

      return {
        success: true,
        data: {
          groups,
          verdicts,
          totalFound: repos.length,
          totalAnalyzed: analyzed.length,
          cached,
          errors,
          hitTimeout,
          summaryMessage,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Scan failed',
      };
    }
  },
};

// ============ HELPER EXPORTS ============

// Re-export for direct use
export { formatScanProgress, formatScanSummary, formatScanTimeout };
