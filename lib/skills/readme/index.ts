/**
 * README Skill
 *
 * WRAPPER around lib/tools/readme/ - does NOT duplicate logic.
 * Provides testable skill interface for README generation.
 *
 * Flow: Fetch repo context → Generate README via Claude → Return content
 */

import type { Skill, SkillContext, SkillResult } from '../_shared/types.js';
import type { TrackedRepo, CoreAnalysis } from '../../core/types.js';
import { GitHubClient } from '../../core/github.js';
import { stateManager } from '../../core/state.js';

// IMPORT from existing modules - DO NOT duplicate
import {
  generateReadme,
  type ReadmeContext,
  type ReadmeRepoInfo,
} from '../../tools/readme/generator.js';

// Re-export types for convenience
export type { ReadmeContext, ReadmeRepoInfo } from '../../tools/readme/generator.js';

// ============ INPUT/OUTPUT TYPES ============

export interface ReadmeSkillInput {
  /** Repository owner */
  owner: string;
  /** Repository name */
  name: string;
  /** Tracked repo (optional - will be fetched if not provided) */
  trackedRepo?: TrackedRepo;
}

export interface ReadmeSkillOutput {
  /** Generated README content */
  content: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  name: string;
  /** Preview (first 500 chars) */
  preview: string;
}

// ============ SKILL DEFINITION ============

export const readmeSkill: Skill<ReadmeSkillInput, ReadmeSkillOutput> = {
  name: 'readme',
  description: 'Generate optimized README for a GitHub repository',
  dependencies: ['github', 'anthropic'],

  progressSteps: [
    'Fetching repo context...',
    'Generating README...',
  ],

  async run(
    input: ReadmeSkillInput,
    ctx: SkillContext
  ): Promise<SkillResult<ReadmeSkillOutput>> {
    const { owner, name } = input;

    try {
      // Step 1: Get tracked repo if not provided
      await ctx.onProgress?.('Fetching repo context...');

      let tracked = input.trackedRepo;
      if (!tracked) {
        tracked = await stateManager.getTrackedRepo(owner, name) ?? undefined;
      }

      if (!tracked?.analysis) {
        return {
          success: false,
          error: `Repo "${owner}/${name}" not analyzed. Run /repo first.`,
        };
      }

      // Fetch context from GitHub
      const github = new GitHubClient(process.env.GITHUB_TOKEN!);

      const [repoInfo, existingReadme, packageJson, fileTree] = await Promise.all([
        github.getRepoInfo(owner, name),
        github.getFileContent(owner, name, 'README.md'),
        github.getFileContent(owner, name, 'package.json'),
        github.getRepoTree(owner, name, 50),
      ]);

      if (!repoInfo) {
        return {
          success: false,
          error: `Could not fetch repo info for "${owner}/${name}"`,
        };
      }

      // Step 2: Generate README
      await ctx.onProgress?.('Generating README...');

      const readmeContext: ReadmeContext = {
        repo: { name, description: repoInfo.description },
        analysis: tracked.analysis,
        existingReadme,
        packageJson,
        fileTree,
      };

      const content = await generateReadme(readmeContext);

      // Generate preview
      const preview = content.length > 500
        ? content.substring(0, 500) + '\n\n..._truncated_'
        : content;

      return {
        success: true,
        data: {
          content,
          owner,
          name,
          preview,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'README generation failed',
      };
    }
  },
};

// ============ HELPER EXPORTS ============

export { generateReadme };
