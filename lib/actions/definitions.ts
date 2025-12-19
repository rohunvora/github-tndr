/**
 * Action Definitions
 * 
 * Core actions that can be chained with automatic dependency resolution.
 * Each action declares its dependencies, cache check, and execution logic.
 */

import type { Action, ActionResult, ActionContext } from './types.js';
import type { TrackedRepo, CoreAnalysis } from '../core/types.js';
import { RepoAnalyzer } from '../analyzer.js';
import { GitHubClient } from '../core/github.js';
import { stateManager } from '../core/state.js';
import { generateCoverImage, generateCoverImageStandalone, type LightweightRepoInfo } from '../tools/preview/generator.js';
import { uploadToGitHub } from '../tools/preview/upload.js';
import { generateReadme } from '../tools/readme/generator.js';
import { info } from '../core/logger.js';

// ============ ANALYZE ACTION ============

/**
 * Analyze a repository with Claude
 * 
 * This is the foundational action - many others depend on it.
 * Performs deep analysis of repo content and generates insights.
 */
export const analyzeAction: Action = {
  name: 'analyze',
  label: 'Analyzing with Claude',
  dependencies: [],
  
  isCached: (repo: TrackedRepo) => {
    // Cached if analysis exists and is recent (within 7 days)
    if (!repo.analysis || !repo.analyzed_at) return false;
    const analyzedAt = new Date(repo.analyzed_at);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return analyzedAt > sevenDaysAgo;
  },
  
  run: async (actx: ActionContext): Promise<ActionResult> => {
    const { owner, name, repo, ctx } = actx;
    
    info('action.analyze', 'Starting analysis', { owner, name });
    
    const analyzer = new RepoAnalyzer(
      process.env.ANTHROPIC_API_KEY!,
      process.env.GITHUB_TOKEN!
    );
    
    const analysis = await analyzer.analyzeRepo(owner, name);
    
    // Determine new state based on verdict
    let state: TrackedRepo['state'] = 'has_core';
    if (analysis.verdict === 'dead') state = 'dead';
    else if (analysis.verdict === 'no_core') state = 'no_core';
    else if (analysis.verdict === 'ship') state = 'ready';
    
    // Update repo
    const updatedRepo: TrackedRepo = {
      ...repo,
      state,
      analysis,
      analyzed_at: new Date().toISOString(),
    };
    
    await stateManager.saveTrackedRepo(updatedRepo);
    
    info('action.analyze', 'Analysis complete', { owner, name, verdict: analysis.verdict });
    
    return { success: true, repo: updatedRepo };
  },
};

// ============ PREVIEW (COVER) ACTION ============

/**
 * Generate a cover image for the repository
 * 
 * Uses Gemini to create a marketing-ready product screenshot.
 * Depends on analysis for best results, but can work standalone.
 */
export const previewAction: Action = {
  name: 'preview',
  label: 'Generating cover image',
  dependencies: ['analyze'],
  
  isCached: (repo: TrackedRepo) => {
    // Cached if cover image URL exists
    return !!repo.cover_image_url;
  },
  
  run: async (actx: ActionContext): Promise<ActionResult> => {
    const { owner, name, repo, ctx } = actx;
    
    info('action.preview', 'Starting image generation', { owner, name });
    
    let imageBuffer: Buffer;
    
    if (repo.analysis) {
      // Use full analysis for better prompt
      imageBuffer = await generateCoverImage(repo, []);
    } else {
      // Fallback to standalone generation using GitHub metadata
      const github = new GitHubClient(process.env.GITHUB_TOKEN!);
      const repoInfo = await github.getRepoInfo(owner, name);
      
      const lightweightInfo: LightweightRepoInfo = {
        name,
        description: repoInfo?.description || null,
        language: repoInfo?.language || null,
      };
      
      imageBuffer = await generateCoverImageStandalone(lightweightInfo, []);
    }
    
    // Upload to GitHub
    const uploadResult = await uploadToGitHub(owner, name, imageBuffer);
    
    if (!uploadResult.imageUploaded) {
      return {
        success: false,
        repo,
        error: uploadResult.error || 'Failed to upload image',
      };
    }
    
    // Update repo with cover URL
    const coverUrl = `https://raw.githubusercontent.com/${owner}/${name}/main/.github/social-preview.png`;
    const updatedRepo: TrackedRepo = {
      ...repo,
      cover_image_url: coverUrl,
    };
    
    await stateManager.saveTrackedRepo(updatedRepo);
    
    info('action.preview', 'Cover generated and uploaded', { owner, name });
    
    // Send the image to the user using InputFile for proper Buffer handling
    const { InputFile } = await import('grammy');
    
    try {
      await ctx.replyWithPhoto(new InputFile(imageBuffer, 'cover.png'), {
        caption: `✨ Cover image generated for *${owner}/${name}*\n\n` +
          `📤 Uploaded to \`.github/social-preview.png\`\n` +
          `${uploadResult.readmeUpdated ? '📝 README updated with header' : ''}`,
        parse_mode: 'Markdown',
      });
    } catch (photoErr) {
      // If photo fails, log and try URL fallback
      info('action.preview', 'Photo send failed, trying URL', { error: String(photoErr) });
      try {
        // Wait a moment for GitHub to process the commit
        await new Promise(r => setTimeout(r, 2000));
        await ctx.replyWithPhoto(coverUrl, {
          caption: `✨ Cover image generated for *${owner}/${name}*\n\n` +
            `📤 Uploaded to \`.github/social-preview.png\``,
          parse_mode: 'Markdown',
        });
      } catch {
        // Last resort: just send text
        await ctx.reply(
          `✨ Cover generated for *${owner}/${name}*!\n\n` +
          `📤 Uploaded to GitHub: \`.github/social-preview.png\`\n` +
          `🔗 [View image](${coverUrl})`,
          { parse_mode: 'Markdown' }
        );
      }
    }
    
    return { success: true, repo: updatedRepo };
  },
};

// ============ README ACTION ============

/**
 * Generate an optimized README
 * 
 * Uses Claude to create a marketing-focused README based on analysis.
 * Always regenerates (not cached) for fresh content.
 */
export const readmeAction: Action = {
  name: 'readme',
  label: 'Generating README',
  dependencies: ['analyze'],
  
  isCached: () => false, // Always regenerate README
  
  run: async (actx: ActionContext): Promise<ActionResult> => {
    const { owner, name, repo, ctx } = actx;
    
    if (!repo.analysis) {
      return {
        success: false,
        repo,
        error: 'Cannot generate README without analysis',
      };
    }
    
    info('action.readme', 'Starting README generation', { owner, name });
    
    const github = new GitHubClient(process.env.GITHUB_TOKEN!);
    
    // Fetch context for README generation
    const [repoInfo, existingReadme, packageJson, fileTree] = await Promise.all([
      github.getRepoInfo(owner, name),
      github.getFileContent(owner, name, 'README.md'),
      github.getFileContent(owner, name, 'package.json'),
      github.getRepoTree(owner, name, 50),
    ]);
    
    if (!repoInfo) {
      return { success: false, repo, error: 'Could not fetch repo info' };
    }
    
    const readme = await generateReadme({
      repo: repoInfo,
      analysis: repo.analysis,
      existingReadme,
      packageJson,
      fileTree,
    });
    
    // Upload README to GitHub
    await github.updateFile(
      owner,
      name,
      'README.md',
      Buffer.from(readme).toString('base64'),
      'Update README with AI-optimized content'
    );
    
    info('action.readme', 'README generated and uploaded', { owner, name });
    
    // Send preview to user
    const preview = readme.substring(0, 500) + (readme.length > 500 ? '...' : '');
    await ctx.reply(
      `📝 README generated for *${owner}/${name}*\n\n` +
      `\`\`\`\n${preview}\n\`\`\`\n\n` +
      `📤 Pushed to repository`,
      { parse_mode: 'Markdown' }
    );
    
    return { success: true, repo };
  },
};

// ============ TLDR ACTION ============

/**
 * Show a quick summary (TLDR) of the repository
 * 
 * Displays the analysis results in a condensed format.
 * If cover exists, shows it too.
 */
export const tldrAction: Action = {
  name: 'tldr',
  label: 'Generating summary',
  dependencies: ['analyze'],
  
  isCached: (repo: TrackedRepo) => {
    // TLDR is just displaying cached analysis - always available if analysis exists
    return !!repo.analysis;
  },
  
  run: async (actx: ActionContext): Promise<ActionResult> => {
    const { owner, name, repo, ctx } = actx;
    const a = repo.analysis;
    
    if (!a) {
      return {
        success: false,
        repo,
        error: 'Cannot generate TLDR without analysis',
      };
    }
    
    info('action.tldr', 'Showing TLDR', { owner, name });
    
    // Build TLDR message
    const verdictEmoji = {
      ship: '🚀',
      cut_to_core: '✂️',
      no_core: '❌',
      dead: '💀',
    }[a.verdict] || '📊';
    
    const tldrText = [
      `*${owner}/${name}*`,
      '',
      `📝 *${a.one_liner}*`,
      '',
      `🎯 *Core Value:* ${a.core_value || 'Not identified'}`,
      '',
      `${verdictEmoji} *Verdict:* ${a.verdict.replace('_', ' ')}`,
      `_${a.verdict_reason}_`,
    ].join('\n');
    
    // If cover exists, send with image
    if (repo.cover_image_url) {
      try {
        await ctx.replyWithPhoto(repo.cover_image_url, {
          caption: tldrText,
          parse_mode: 'Markdown',
        });
      } catch {
        // If image fails, send text only
        await ctx.reply(tldrText, { parse_mode: 'Markdown' });
      }
    } else {
      await ctx.reply(tldrText, { parse_mode: 'Markdown' });
    }
    
    return { success: true, repo };
  },
};

// ============ EXPORT ALL ACTIONS ============

export const allActions: Action[] = [
  analyzeAction,
  previewAction,
  readmeAction,
  tldrAction,
];

