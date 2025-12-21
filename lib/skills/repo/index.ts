/**
 * Repo Analysis Skill
 *
 * WRAPPER around lib/tools/repo/ - does NOT duplicate logic.
 * Provides testable skill interface for repo analysis.
 *
 * Flow: GitHub repo → Fetch data → Claude analysis → CoreAnalysis result
 */

import type { Skill, SkillContext, SkillResult } from '../_shared/types.js';
import type { CoreAnalysis, TrackedRepo } from '../../core/types.js';

// IMPORT from existing modules - DO NOT duplicate
import { RepoAnalyzer, getRepoAnalyzer } from '../../tools/repo/analyzer.js';
import { formatCard, formatDetails, verdictToState } from '../../tools/repo/format.js';
import { stateManager } from '../../core/state.js';

// Re-export types for convenience
export type { CoreAnalysis } from '../../core/types.js';

// ============ INPUT/OUTPUT TYPES ============

export interface RepoSkillInput {
  /** Repository owner (GitHub username/org) */
  owner: string;
  /** Repository name */
  name: string;
  /** Skip cache and force re-analysis */
  forceRefresh?: boolean;
}

export interface RepoSkillOutput {
  /** The analysis result */
  analysis: CoreAnalysis;
  /** Tracked repo with full state */
  trackedRepo: TrackedRepo;
  /** Formatted card message */
  cardMessage: string;
  /** Formatted details message */
  detailsMessage: string;
  /** Whether this was from cache */
  cached: boolean;
}

// ============ SKILL DEFINITION ============

export const repoSkill: Skill<RepoSkillInput, RepoSkillOutput> = {
  name: 'repo',
  description: 'Analyze GitHub repositories for core value and verdict',
  dependencies: ['github', 'anthropic'],

  progressSteps: [
    'Fetching repo data...',
    'Running analysis...',
    'Formatting results...',
  ],

  async run(
    input: RepoSkillInput,
    ctx: SkillContext
  ): Promise<SkillResult<RepoSkillOutput>> {
    const { owner, name, forceRefresh = false } = input;

    try {
      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = await stateManager.getTrackedRepo(owner, name);
        if (cached?.analysis) {
          return {
            success: true,
            cached: true,
            data: {
              analysis: cached.analysis,
              trackedRepo: cached,
              cardMessage: formatCard(cached),
              detailsMessage: formatDetails(cached),
              cached: true,
            },
          };
        }
      }

      // Step 1: Fetch repo data and analyze
      await ctx.onProgress?.('Fetching repo data...');

      const analyzer = getRepoAnalyzer();

      await ctx.onProgress?.('Running analysis...', 'Claude');
      const analysis = await analyzer.analyzeRepo(owner, name);

      // Step 2: Save to state
      await ctx.onProgress?.('Formatting results...');

      const tracked: TrackedRepo = {
        id: `${owner}/${name}`,
        name,
        owner,
        state: verdictToState(analysis.verdict),
        analysis,
        analyzed_at: new Date().toISOString(),
        pending_action: null,
        pending_since: null,
        last_message_id: null,
        last_push_at: null,
        killed_at: null,
        shipped_at: null,
        cover_image_url: null,
        homepage: null,
      };

      await stateManager.saveTrackedRepo(tracked);

      return {
        success: true,
        data: {
          analysis,
          trackedRepo: tracked,
          cardMessage: formatCard(tracked),
          detailsMessage: formatDetails(tracked),
          cached: false,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Analysis failed',
      };
    }
  },

  async isCached(input: RepoSkillInput, ctx: SkillContext): Promise<boolean> {
    const cached = await stateManager.getTrackedRepo(input.owner, input.name);
    return !!cached?.analysis;
  },
};

// ============ HELPER EXPORTS ============

// Re-export for direct use
export { RepoAnalyzer, getRepoAnalyzer, formatCard, formatDetails, verdictToState };
