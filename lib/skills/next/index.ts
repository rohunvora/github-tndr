/**
 * Next Skill
 *
 * WRAPPER around lib/tools/next/ - does NOT duplicate logic.
 * Provides testable skill interface for project selection carousel.
 *
 * Flow: Get active repos → Calculate scores → Return sorted candidates
 */

import type { Skill, SkillContext, SkillResult } from '../_shared/types.js';
import type { TrackedRepo } from '../../core/types.js';

// IMPORT from existing modules - DO NOT duplicate
import {
  getProjectCandidates,
  type ProjectCandidate,
} from '../../tools/next/selector.js';
import {
  formatCarouselCard,
  formatNoProjects,
  formatSelected,
} from '../../tools/next/format.js';

// Re-export types for convenience
export type { ProjectCandidate } from '../../tools/next/selector.js';

// ============ INPUT/OUTPUT TYPES ============

export interface NextSkillInput {
  /** Maximum candidates to return (default: all) */
  limit?: number;
  /** Minimum momentum filter */
  minMomentum?: 'high' | 'medium' | 'low';
}

export interface NextSkillOutput {
  /** Sorted project candidates */
  candidates: ProjectCandidate[];
  /** Total active repos found */
  totalActive: number;
  /** Formatted card for first candidate */
  firstCardMessage?: string;
  /** Message when no projects available */
  noProjectsMessage?: string;
}

// ============ SKILL DEFINITION ============

export const nextSkill: Skill<NextSkillInput, NextSkillOutput> = {
  name: 'next',
  description: 'Select next project to work on based on momentum and context',
  dependencies: ['github'],

  progressSteps: [
    'Finding active projects...',
    'Calculating momentum...',
    'Ranking candidates...',
  ],

  async run(
    input: NextSkillInput,
    ctx: SkillContext
  ): Promise<SkillResult<NextSkillOutput>> {
    const { limit, minMomentum } = input;

    try {
      // Step 1: Get candidates from existing selector
      await ctx.onProgress?.('Finding active projects...');

      let candidates = await getProjectCandidates();

      if (candidates.length === 0) {
        return {
          success: true,
          data: {
            candidates: [],
            totalActive: 0,
            noProjectsMessage: formatNoProjects(),
          },
        };
      }

      const totalActive = candidates.length;

      // Step 2: Apply filters
      await ctx.onProgress?.('Calculating momentum...');

      if (minMomentum) {
        const momentumOrder = { high: 3, medium: 2, low: 1 };
        const minLevel = momentumOrder[minMomentum];
        candidates = candidates.filter(
          c => momentumOrder[c.momentum] >= minLevel
        );
      }

      // Step 3: Apply limit
      await ctx.onProgress?.('Ranking candidates...');

      if (limit && limit > 0) {
        candidates = candidates.slice(0, limit);
      }

      // Format first card if available
      const firstCardMessage = candidates.length > 0
        ? formatCarouselCard(candidates[0], 0, candidates.length)
        : undefined;

      return {
        success: true,
        data: {
          candidates,
          totalActive,
          firstCardMessage,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to get candidates',
      };
    }
  },
};

// ============ HELPER EXPORTS ============

export { formatCarouselCard, formatNoProjects, formatSelected };
