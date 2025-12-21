/**
 * Preview Skill
 *
 * WRAPPER around lib/tools/preview/ - does NOT duplicate logic.
 * Provides testable skill interface for cover image generation.
 *
 * Flow: Repo → Analyze (optional) → Generate (Gemini) → Upload (GitHub)
 */

import type { Skill, SkillContext, SkillResult } from '../_shared/types.js';
import type { TrackedRepo } from '../../core/types.js';

// IMPORT from existing modules - DO NOT duplicate
import {
  generateCoverImage,
  generateCoverImageStandalone,
  type LightweightRepoInfo,
} from '../../tools/preview/generator.js';
import { uploadToGitHub, getSettingsUrl, type UploadResult } from '../../tools/preview/upload.js';

// Re-export types for convenience
export type { LightweightRepoInfo } from '../../tools/preview/generator.js';
export type { UploadResult } from '../../tools/preview/upload.js';

// ============ INPUT/OUTPUT TYPES ============

export interface PreviewSkillInput {
  /** Repository owner (GitHub username/org) */
  owner: string;
  /** Repository name */
  name: string;
  /** Full tracked repo with analysis (optional - uses lightweight mode if missing) */
  trackedRepo?: TrackedRepo;
  /** Lightweight repo info for standalone mode */
  repoInfo?: LightweightRepoInfo;
  /** User feedback for regeneration */
  feedback?: string[];
}

export interface PreviewSkillOutput {
  /** Generated image as Buffer */
  imageBuffer: Buffer;
  /** Generated image as base64 */
  imageBase64: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  name: string;
}

export interface UploadSkillInput {
  /** Repository owner */
  owner: string;
  /** Repository name */
  name: string;
  /** Image to upload */
  imageBuffer: Buffer;
}

export interface UploadSkillOutput {
  /** Upload result */
  result: UploadResult;
  /** Settings URL for social preview */
  settingsUrl: string;
  /** Raw image URL */
  imageUrl: string;
}

// ============ PREVIEW SKILL ============

export const previewSkill: Skill<PreviewSkillInput, PreviewSkillOutput> = {
  name: 'preview',
  description: 'Generate cover images for GitHub repos',
  dependencies: ['gemini', 'github'],

  progressSteps: [
    'Generating cover...',
  ],

  async run(
    input: PreviewSkillInput,
    ctx: SkillContext
  ): Promise<SkillResult<PreviewSkillOutput>> {
    const { owner, name, trackedRepo, repoInfo, feedback = [] } = input;

    // Validate input
    if (!trackedRepo && !repoInfo) {
      return {
        success: false,
        error: 'Either trackedRepo (with analysis) or repoInfo (lightweight) is required',
      };
    }

    await ctx.onProgress?.('Generating cover...', 'Gemini');

    try {
      let imageBuffer: Buffer;

      if (trackedRepo?.analysis) {
        // Full mode: use analysis for richer prompts
        imageBuffer = await generateCoverImage(trackedRepo, feedback);
      } else if (repoInfo) {
        // Lightweight mode: use GitHub metadata only
        imageBuffer = await generateCoverImageStandalone(repoInfo, feedback);
      } else {
        return {
          success: false,
          error: 'No analysis or repo info available for generation',
        };
      }

      return {
        success: true,
        data: {
          imageBuffer,
          imageBase64: imageBuffer.toString('base64'),
          owner,
          name,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Image generation failed',
      };
    }
  },
};

// ============ UPLOAD SKILL ============

export const uploadSkill: Skill<UploadSkillInput, UploadSkillOutput> = {
  name: 'preview-upload',
  description: 'Upload cover image to GitHub',
  dependencies: ['github'],

  progressSteps: [
    'Uploading to GitHub...',
  ],

  async run(
    input: UploadSkillInput,
    ctx: SkillContext
  ): Promise<SkillResult<UploadSkillOutput>> {
    const { owner, name, imageBuffer } = input;

    await ctx.onProgress?.('Uploading to GitHub...');

    try {
      const result = await uploadToGitHub(owner, name, imageBuffer);

      if (!result.imageUploaded) {
        return {
          success: false,
          error: result.error || 'Upload failed',
        };
      }

      return {
        success: true,
        data: {
          result,
          settingsUrl: getSettingsUrl(owner, name),
          imageUrl: `https://raw.githubusercontent.com/${owner}/${name}/main/.github/social-preview.png`,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Upload failed',
      };
    }
  },
};

// ============ HELPER EXPORTS ============

// Re-export for direct use
export { generateCoverImage, generateCoverImageStandalone, uploadToGitHub, getSettingsUrl };
