/**
 * README Tool Handler
 * Generate and update READMEs
 */

import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { stateManager } from '../../core/state.js';
import { GitHubClient } from '../../core/github.js';
import { readmeSkill } from '../../skills/readme/index.js';
import { acquireLock, releaseLock } from '../../core/update-guard.js';

// Store pending READMEs
const pendingReadmes = new Map<string, {
  owner: string;
  name: string;
  content: string;
}>();

/**
 * Handle /readme command
 */
export async function handleReadmeCommand(ctx: Context, input: string): Promise<void> {
  if (!input) {
    await ctx.reply('Usage: `/readme <repo>` or `/readme owner/repo`', { parse_mode: 'Markdown' });
    return;
  }

  // Layer 2: Command-level lock prevents concurrent README generation for same repo
  const lockKey = `readme:${ctx.chat!.id}:${input.toLowerCase()}`;
  if (!await acquireLock(lockKey, 120)) {  // 2 min TTL
    await ctx.reply('⏳ Already generating README for this repo...');
    return;
  }

  info('readme', 'Starting', { input });

  // Show progress
  const progressMsg = await ctx.reply('📝 Generating README...');

  try {
    // Resolve repo
    const { owner, name } = await resolveRepo(input);

    // Generate README via skill
    const result = await readmeSkill.run({ owner, name }, {
      github: new GitHubClient(process.env.GITHUB_TOKEN!),
      anthropic: {} as never,
      gemini: {} as never,
      kv: {} as never,
      telegram: {} as never,
      sessions: {} as never,
      onProgress: async (step) => {
        try {
          await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, `📝 ${step}`);
        } catch { /* rate limit */ }
      },
    });

    if (!result.success) {
      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, `❌ ${result.error}`);
      return;
    }

    const { content, preview } = result.data!;

    // Delete progress
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);
    } catch { /* ok */ }

    // Store pending README
    const sessionId = `readme_${Date.now()}`;
    pendingReadmes.set(sessionId, { owner, name, content });

    await ctx.reply(`📝 **${name}** README preview:\n\n\`\`\`markdown\n${preview}\n\`\`\``, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('✅ Push to GitHub', `readme_push:${sessionId}`)
        .text('📋 Copy Full', `readme_copy:${sessionId}`)
        .row()
        .text('❌ Cancel', `readme_cancel:${sessionId}`),
    });

    info('readme', 'Preview sent', { repo: name, sessionId });

  } catch (err) {
    logErr('readme', err, { input });
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    const timestamp = new Date().toISOString();
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMsg.message_id,
      `❌ **/readme ${input}** failed\n\n` +
      `**Error:** \`${errorMsg}\`\n` +
      `**Time:** ${timestamp}\n\n` +
      `_Copy this message to debug_`,
      { parse_mode: 'Markdown' }
    );
  } finally {
    // Always release lock when done (success or error)
    await releaseLock(lockKey);
  }
}

/**
 * Handle push to GitHub
 */
export async function handleReadmePush(ctx: Context, sessionId: string): Promise<void> {
  const pending = pendingReadmes.get(sessionId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: 'Session expired' });
    return;
  }

  const { owner, name, content } = pending;
  info('readme', 'Pushing to GitHub', { owner, name });

  await ctx.answerCallbackQuery({ text: 'Pushing...' });

  try {
    const github = new GitHubClient(process.env.GITHUB_TOKEN!);

    await github.updateFile(
      owner,
      name,
      'README.md',
      content,
      'Update README'
    );

    pendingReadmes.delete(sessionId);

    await ctx.editMessageText(
      `✅ **${name}** README pushed!\n→ github.com/${owner}/${name}`,
      { parse_mode: 'Markdown' }
    );

    info('readme', 'Pushed', { owner, name });

  } catch (err) {
    logErr('readme', err, { owner, name });
    await ctx.editMessageText(
      `❌ Push failed: ${err instanceof Error ? err.message : 'Unknown'}`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle copy full (send as text)
 */
export async function handleReadmeCopy(ctx: Context, sessionId: string): Promise<void> {
  const pending = pendingReadmes.get(sessionId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: 'Session expired' });
    return;
  }

  await ctx.answerCallbackQuery();
  
  // Send full README as code block (may need to split)
  const { content, name } = pending;
  
  if (content.length > 4000) {
    // Split into chunks
    const chunks = content.match(/.{1,4000}/gs) || [];
    await ctx.reply(`📝 **${name}** README (${chunks.length} parts):`, { parse_mode: 'Markdown' });
    for (let i = 0; i < chunks.length; i++) {
      await ctx.reply(`\`\`\`markdown\n${chunks[i]}\n\`\`\``, { parse_mode: 'Markdown' });
    }
  } else {
    await ctx.reply(`\`\`\`markdown\n${content}\n\`\`\``, { parse_mode: 'Markdown' });
  }
}

/**
 * Handle cancel
 */
export async function handleReadmeCancel(ctx: Context, sessionId: string): Promise<void> {
  pendingReadmes.delete(sessionId);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  await ctx.deleteMessage();
}

// Helper
async function resolveRepo(input: string): Promise<{ owner: string; name: string }> {
  if (input.includes('/')) {
    const [owner, name] = input.split('/');
    return { owner, name };
  }

  const repo = await stateManager.getTrackedRepoByName(input);
  if (repo) {
    return { owner: repo.owner, name: repo.name };
  }

  throw new Error(`Repo "${input}" not found. Use owner/name format.`);
}

