/**
 * Chart Analysis Skill
 *
 * WRAPPER around lib/chart/ - does NOT duplicate logic.
 * Provides testable skill interface for chart analysis.
 *
 * Flow: Photo → Analyze (Gemini Vision) → Annotate (Gemini Image) → Result
 */

import type { Skill, SkillContext, SkillResult } from '../_shared/types.js';

// IMPORT from existing module - DO NOT duplicate
import {
  analyzeChart,
  annotateChart,
  formatChartCaption,
  formatChartError,
  type ChartAnalysis,
} from '../../chart/index.js';

// Re-export types for convenience
export type { ChartAnalysis } from '../../chart/index.js';

// ============ INPUT/OUTPUT TYPES ============

export interface ChartSkillInput {
  /** Base64 encoded chart image */
  imageBase64: string;
  /** Optional user question about the chart */
  question?: string;
}

export interface ChartSkillOutput {
  /** The analysis result */
  analysis: ChartAnalysis;
  /** Base64 annotated image (null if annotation failed) */
  annotatedImage: string | null;
  /** Formatted caption for the image */
  caption: string;
}

// ============ SKILL DEFINITION ============

export const chartSkill: Skill<ChartSkillInput, ChartSkillOutput> = {
  name: 'chart',
  description: 'Analyze trading chart screenshots and annotate with TA zones',
  dependencies: ['gemini'],

  progressSteps: [
    'Extracting levels...',
    'Drawing zones...',
  ],

  async run(
    input: ChartSkillInput,
    ctx: SkillContext
  ): Promise<SkillResult<ChartSkillOutput>> {
    const { imageBase64, question } = input;

    // Step 1: Analyze the chart
    await ctx.onProgress?.('Extracting levels...', 'Gemini Vision');

    const analysis = await analyzeChart(imageBase64, question);

    if (!analysis.success) {
      return {
        success: false,
        error: analysis.error || 'Analysis failed',
      };
    }

    if (analysis.keyZones.length === 0) {
      return {
        success: false,
        error: 'No zones detected',
      };
    }

    // Step 2: Annotate the chart
    await ctx.onProgress?.(
      'Drawing zones...',
      `${analysis.keyZones.length} zone${analysis.keyZones.length !== 1 ? 's' : ''}`
    );

    const annotatedImage = await annotateChart(imageBase64, analysis);

    // Return result (annotation can fail but analysis succeeded)
    return {
      success: true,
      data: {
        analysis,
        annotatedImage,
        caption: formatChartCaption(analysis),
      },
    };
  },
};

// ============ HELPER EXPORTS ============

// Re-export formatting helpers for use in handlers
export { formatChartCaption, formatChartError };
