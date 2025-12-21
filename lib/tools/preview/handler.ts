/**
 * Preview Tool Handler
 * 
 * Orchestrates the complete preview flow:
 * 1. Resolve repo (by name or owner/name)
 * 2. Fetch repo info from GitHub
 * 3. Auto-analyze if no prior analysis exists
 * 4. Generate cover image with Gemini
 * 5. Show preview with approval buttons
 * 6. Handle approve/reject/cancel callbacks
 * 
 * This handler is intentionally thin - it delegates to focused modules:
 * - progress.ts: Breadcrumb progress display
 * - sessions.ts: Session state management (Vercel KV)
 * - generator.ts: Image generation (Gemini + fallback)
 * - upload.ts: GitHub upload + README update
 * - feedback.ts: Reject flow and regeneration
 * 
 * @example
 * ```
 * /preview my-repo
 * → Resolving ✓
 * → Fetching ✓
 * → Analyzing (no prior analysis)...
 * → Generating cover...
 * [IMAGE PREVIEW]
 * [Approve] [Reject] [Cancel]
 * ```
 */

import type { Context } from 'grammy';
import { InputFile, InlineKeyboard } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { stateManager } from '../../core/state.js';
import { GitHubClient } from '../../core/github.js';
import type { TrackedRepo, CoreAnalysis, RepoState } from '../../core/types.js';
import { getRepoAnalyzer } from '../repo/analyzer.js';
import { acquireLock, releaseLock } from '../../core/update-guard.js';
import { 
  createProgressTracker, 
  updateProgress, 
  skipPhase,
  completeProgress, 
  failProgress,
} from './progress.js';
import { createSession, getSession, deleteSession } from './sessions.js';
import { previewSkill } from '../../skills/preview/index.js';
import { uploadToGitHub, getSettingsUrl } from './upload.js';
import { handleRejectButton, sendPreviewImage } from './feedback.js';

// ============ GitHub Client Singleton ============

let github: GitHubClient | null = null;

function getGitHub(): GitHubClient {
  if (!github) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN not configured');
    }
    github = new GitHubClient(token);
  }
  return github;
}

// ============ Main Command Handler ============

/**
 * Handle /preview command
 * 
 * Full flow: resolve → fetch → analyze (if needed) → generate → show preview
 * 
 * @param ctx - Grammy context
 * @param input - User input (repo name or owner/name)
 */
export async function handlePreviewCommand(ctx: Context, input: string): Promise<void> {
  if (!input) {
    await ctx.reply(
      'Usage: `/preview <repo>` or `/preview owner/repo`\n\n' +
      'Generates a cover image for your repo and uploads it to GitHub.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Layer 2: Command-level lock prevents concurrent preview generation for same repo
  // This catches cases where user sends /preview twice quickly, or different update_ids
  const lockKey = `preview:${ctx.chat!.id}:${input.toLowerCase()}`;
  if (!await acquireLock(lockKey, 120)) {  // 2 min TTL
    await ctx.reply('⏳ Already generating preview for this repo...');
    return;
  }

  info('preview', 'Starting', { input });

  // Create progress tracker
  const tracker = await createProgressTracker(ctx, input);

  try {
    // 1. RESOLVE - Find owner/name from input
    await updateProgress(tracker, 'resolving');
    const { owner, name } = await resolveRepo(input);
    info('preview', 'Resolved', { owner, name });

    // 2. FETCH - Get repo info from GitHub
    await updateProgress(tracker, 'fetching');
    const repoInfo = await getGitHub().getRepoInfo(owner, name);
    if (!repoInfo) {
      throw new Error(`Repo "${owner}/${name}" not found or private`);
    }

    // 3. CHECK for existing analysis (don't run new analysis - keeps us within timeout)
    const repo = await stateManager.getTrackedRepo(owner, name);
    const hasAnalysis = !!repo?.analysis;
    
    if (hasAnalysis) {
      await skipPhase(tracker, 'analyzing');
      info('preview', 'Using cached analysis', { owner, name });
    } else {
      await skipPhase(tracker, 'analyzing');
      info('preview', 'No analysis, using GitHub metadata', { owner, name });
    }

    // 4. GENERATE - Create cover image using skill
    await updateProgress(tracker, 'generating', 'Gemini');

    const skillResult = await previewSkill.run({
      owner,
      name,
      trackedRepo: hasAnalysis ? repo! : undefined,
      repoInfo: {
        name,
        description: repoInfo.description,
        language: repoInfo.language,
      },
    }, {
      // Minimal context - skill uses global clients internally
      github: getGitHub(),
      anthropic: {} as never,
      gemini: {} as never,
      kv: {} as never,
      telegram: {} as never,
      sessions: {} as never,
    });

    if (!skillResult.success) {
      throw new Error(skillResult.error || 'Image generation failed');
    }

    const imageBuffer = skillResult.data!.imageBuffer;

    // 5. SHOW PREVIEW - Delete progress, send image with buttons
    await completeProgress(tracker);

    const sessionId = await createSession({
      owner,
      name,
      imageBase64: imageBuffer.toString('base64'),
      feedback: [],
      attempt: 1,
    });

    await sendPreviewImage(ctx, imageBuffer, name, sessionId, 1);

    info('preview', 'Preview sent', { owner, name, sessionId });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logErr('preview', err, { input });
    await failProgress(tracker, errorMessage);
  } finally {
    // Always release lock when done (success or error)
    await releaseLock(lockKey);
  }
}

// ============ Callback Handlers ============

/**
 * Handle preview approval - upload to GitHub
 */
export async function handlePreviewApprove(ctx: Context, sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'Session expired - run /preview again' });
    return;
  }

  const { owner, name, imageBase64 } = session;
  info('preview', 'Approval received', { owner, name, sessionId });

  await ctx.answerCallbackQuery({ text: 'Uploading to GitHub...' });

  try {
    // Convert base64 back to Buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    // Upload to GitHub
    const result = await uploadToGitHub(owner, name, imageBuffer);

    // Clean up session
    await deleteSession(sessionId);

    // Build success message
    let successMsg = `✅ **${name}** uploaded!\n\n`;
    successMsg += `→ \`.github/social-preview.png\``;
    if (result.readmeUpdated) {
      successMsg += `\n→ README.md header added`;
    }
    successMsg += `\n\n💡 [Set as social preview](${getSettingsUrl(owner, name)})`;

    // Update the message caption
    await ctx.editMessageCaption({
      caption: successMsg,
      parse_mode: 'Markdown',
    });

    info('preview', 'Upload complete', { owner, name, result });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logErr('preview', err, { owner, name });

    await ctx.editMessageCaption({
      caption: `❌ **Upload failed**\n\n${errorMessage}`,
      parse_mode: 'Markdown',
    });
  }
}

/**
 * Handle preview rejection - delegate to feedback module
 */
export { handleRejectButton as handlePreviewReject } from './feedback.js';

/**
 * Handle preview cancellation - clean up session
 */
export async function handlePreviewCancel(ctx: Context, sessionId: string): Promise<void> {
  await deleteSession(sessionId);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  
  try {
    await ctx.deleteMessage();
  } catch {
    // Message may already be deleted
  }
  
  info('preview', 'Cancelled', { sessionId });
}

// ============ Helpers ============

/**
 * Resolves user input to owner/name
 * Handles both "repo-name" and "owner/repo-name" formats
 */
async function resolveRepo(input: string): Promise<{ owner: string; name: string }> {
  // If input contains /, treat as owner/name
  if (input.includes('/')) {
    const [owner, name] = input.split('/');
    return { owner, name };
  }

  // Otherwise, search user's repos by name
  const repos = await getGitHub().getUserRepos();
  const found = repos.find(r => r.name.toLowerCase() === input.toLowerCase());
  
  if (!found) {
    throw new Error(`"${input}" not found in your repos. Use owner/name for external repos.`);
  }
  
  return { owner: found.full_name.split('/')[0], name: found.name };
}

/**
 * Maps analysis verdict to repo state
 */
function verdictToState(verdict: CoreAnalysis['verdict']): RepoState {
  switch (verdict) {
    case 'ship': return 'ready';
    case 'cut_to_core': return 'has_core';
    case 'no_core': return 'no_core';
    case 'dead': return 'dead';
    default: return 'ready';
  }
}

/**
 * Saves or updates a tracked repo with analysis data
 */
async function saveTrackedRepo(
  owner: string,
  name: string,
  analysis: CoreAnalysis,
  repoInfo: { pushed_at: string; homepage: string | null }
): Promise<TrackedRepo> {
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
    last_push_at: repoInfo.pushed_at,
    killed_at: null,
    shipped_at: null,
    cover_image_url: null,
    homepage: repoInfo.homepage,
  };
  
  await stateManager.saveTrackedRepo(tracked);
  return tracked;
}
