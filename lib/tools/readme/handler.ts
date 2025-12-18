/**
 * README Tool Handler
 * Generate and update READMEs
 */

import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { stateManager } from '../../core/state.js';
import { GitHubClient } from '../../core/github.js';
import { generateReadme } from './generator.js';

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

  info('readme', 'Starting', { input });

  // Resolve repo
  const { owner, name } = await resolveRepo(input);

  // Get tracked repo
  const tracked = await stateManager.getTrackedRepo(owner, name);
  if (!tracked?.analysis) {
    await ctx.reply(`❌ Repo "${owner}/${name}" not analyzed. Run \`/repo ${input}\` first.`, { parse_mode: 'Markdown' });
    return;
  }

  // Show progress
  const progressMsg = await ctx.reply('📝 Generating README...');
  
  try {
    const github = new GitHubClient(process.env.GITHUB_TOKEN!);

    // Fetch context
    const [repoInfo, existingReadme, packageJson, fileTree] = await Promise.all([
      github.getRepoInfo(owner, name),
      github.getFileContent(owner, name, 'README.md'),
      github.getFileContent(owner, name, 'package.json'),
      github.getRepoTree(owner, name, 50),
    ]);

    if (!repoInfo) {
      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '❌ Could not fetch repo info');
      return;
    }

    // Generate README
    const readme = await generateReadme({
      repo: {
        id: 0,
        name,
        full_name: `${owner}/${name}`,
        description: repoInfo.description,
        updated_at: '',
        pushed_at: repoInfo.pushed_at,
        default_branch: repoInfo.default_branch,
        homepage: repoInfo.homepage,
        topics: [],
        private: false,
        stargazers_count: repoInfo.stars,
        size: 0,
      },
      analysis: tracked.analysis,
      existingReadme,
      packageJson,
      fileTree,
    });

    // Delete progress
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);
    } catch { /* ok */ }

    // Store pending README
    const sessionId = `readme_${Date.now()}`;
    pendingReadmes.set(sessionId, { owner, name, content: readme });

    // Send preview (truncated)
    const preview = readme.length > 500 
      ? readme.substring(0, 500) + '\n\n..._truncated_'
      : readme;

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
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMsg.message_id,
      `❌ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
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

