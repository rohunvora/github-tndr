/**
 * Preview Tool Handler
 * Generate cover images and add to README
 */

import type { Context } from 'grammy';
import { InlineKeyboard, InputFile } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { stateManager } from '../../core/state.js';
import { GitHubClient } from '../../core/github.js';
import { generateCoverImage } from './generator.js';

// Store pending previews (sessionId -> { owner, name, imageBuffer })
const pendingPreviews = new Map<string, {
  owner: string;
  name: string;
  imageBuffer: Buffer;
}>();

/**
 * Handle /preview command
 */
export async function handlePreviewCommand(ctx: Context, input: string): Promise<void> {
  if (!input) {
    await ctx.reply('Usage: `/preview <repo>` or `/preview owner/repo`', { parse_mode: 'Markdown' });
    return;
  }

  info('preview', 'Starting', { input });

  // Resolve repo
  const { owner, name } = await resolveRepo(input);

  // Get tracked repo
  const repo = await stateManager.getTrackedRepo(owner, name);
  if (!repo?.analysis) {
    await ctx.reply(`❌ Repo "${owner}/${name}" not analyzed. Run \`/repo ${input}\` first.`, { parse_mode: 'Markdown' });
    return;
  }

  // Show progress
  const progressMsg = await ctx.reply('🎨 Generating cover image...');
  
  try {
    // Generate cover
    const imageBuffer = await generateCoverImage(repo);

    // Delete progress message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);
    } catch { /* ok */ }

    // Create session ID for this preview
    const sessionId = `preview_${Date.now()}`;
    pendingPreviews.set(sessionId, { owner, name, imageBuffer });

    // Send preview with approval buttons
    await ctx.replyWithPhoto(new InputFile(imageBuffer, `${name}-cover.png`), {
      caption: `🎨 **${name}** preview`,
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('✅ Add to README', `preview_use:${sessionId}`)
        .text('🔄 Regenerate', `preview_regen:${sessionId}`)
        .row()
        .text('❌ Cancel', `preview_cancel:${sessionId}`),
    });

    info('preview', 'Preview sent', { repo: name, sessionId });

  } catch (err) {
    logErr('preview', err, { input });
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMsg.message_id,
      `❌ Failed to generate: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

/**
 * Handle preview approval - add to README
 */
export async function handlePreviewUse(ctx: Context, sessionId: string): Promise<void> {
  const preview = pendingPreviews.get(sessionId);
  if (!preview) {
    await ctx.answerCallbackQuery({ text: 'Preview expired' });
    return;
  }

  const { owner, name, imageBuffer } = preview;
  info('preview', 'Adding to README', { owner, name });

  await ctx.answerCallbackQuery({ text: 'Adding to README...' });

  try {
    const github = new GitHubClient(process.env.GITHUB_TOKEN!);

    // Upload image to .github/social-preview.png
    const imagePath = '.github/social-preview.png';
    await github.updateFile(
      owner,
      name,
      imagePath,
      imageBuffer.toString('base64'),
      'Add social preview image'
    );

    // Update repo with cover URL
    const repo = await stateManager.getTrackedRepo(owner, name);
    if (repo) {
      repo.cover_image_url = `https://raw.githubusercontent.com/${owner}/${name}/main/${imagePath}`;
      await stateManager.saveTrackedRepo(repo);
    }

    // Clean up
    pendingPreviews.delete(sessionId);

    // Update message
    await ctx.editMessageCaption({
      caption: `✅ **${name}** cover added!\n→ \`${imagePath}\``,
      parse_mode: 'Markdown',
    });

    info('preview', 'Added to README', { owner, name });

  } catch (err) {
    logErr('preview', err, { owner, name });
    await ctx.editMessageCaption({
      caption: `❌ Failed to add: ${err instanceof Error ? err.message : 'Unknown'}`,
      parse_mode: 'Markdown',
    });
  }
}

/**
 * Handle regenerate
 */
export async function handlePreviewRegen(ctx: Context, sessionId: string): Promise<void> {
  const preview = pendingPreviews.get(sessionId);
  if (!preview) {
    await ctx.answerCallbackQuery({ text: 'Preview expired' });
    return;
  }

  const { owner, name } = preview;
  await ctx.answerCallbackQuery({ text: 'Regenerating...' });

  try {
    const repo = await stateManager.getTrackedRepo(owner, name);
    if (!repo?.analysis) {
      await ctx.editMessageCaption({ caption: '❌ Repo not found' });
      return;
    }

    const imageBuffer = await generateCoverImage(repo);

    // Update pending preview
    pendingPreviews.set(sessionId, { owner, name, imageBuffer });

    // Send new image (can't edit media, so delete and resend)
    await ctx.deleteMessage();
    await ctx.replyWithPhoto(new InputFile(imageBuffer, `${name}-cover.png`), {
      caption: `🎨 **${name}** preview (regenerated)`,
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('✅ Add to README', `preview_use:${sessionId}`)
        .text('🔄 Regenerate', `preview_regen:${sessionId}`)
        .row()
        .text('❌ Cancel', `preview_cancel:${sessionId}`),
    });

  } catch (err) {
    logErr('preview', err, { owner, name });
    await ctx.editMessageCaption({
      caption: `❌ Regeneration failed: ${err instanceof Error ? err.message : 'Unknown'}`,
    });
  }
}

/**
 * Handle cancel
 */
export async function handlePreviewCancel(ctx: Context, sessionId: string): Promise<void> {
  pendingPreviews.delete(sessionId);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  await ctx.deleteMessage();
}

// Helper to resolve repo
async function resolveRepo(input: string): Promise<{ owner: string; name: string }> {
  if (input.includes('/')) {
    const [owner, name] = input.split('/');
    return { owner, name };
  }

  // Try to find by name in tracked repos
  const repo = await stateManager.getTrackedRepoByName(input);
  if (repo) {
    return { owner: repo.owner, name: repo.name };
  }

  throw new Error(`Repo "${input}" not found. Use owner/name format.`);
}

