import { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { info, error as logErr } from '../../logger.js';
import { TrackedRepo } from '../../core-types.js';
import { GitHubClient } from '../../github.js';
import { RepoAnalyzer } from '../../analyzer.js';
import { stateManager } from '../../state.js';
import { formatCard, formatDetails } from '../format.js';

// Singleton instances (initialized on first use)
let analyzer: RepoAnalyzer | null = null;
let github: GitHubClient | null = null;

function getAnalyzer(): RepoAnalyzer {
  if (!analyzer) {
    analyzer = new RepoAnalyzer(
      process.env.ANTHROPIC_API_KEY!,
      process.env.GITHUB_TOKEN!
    );
  }
  return analyzer;
}

function getGitHub(): GitHubClient {
  if (!github) {
    github = new GitHubClient(process.env.GITHUB_TOKEN!);
  }
  return github;
}

/**
 * Handle /repo command
 * Clean, focused, with proper logging
 */
export async function handleRepo(ctx: Context, input: string): Promise<void> {
  info('repo', 'Starting', { input });

  // Show progress
  const progress = await ctx.reply(`🔍 Analyzing **${input}**...`, { parse_mode: 'Markdown' });

  try {
    // 1. Resolve owner/name
    const { owner, name } = await resolveRepo(input);
    info('repo', 'Resolved', { owner, name });

    // 2. Verify repo exists
    const repoInfo = await getGitHub().getRepoInfo(owner, name);
    if (!repoInfo) {
      await editProgress(ctx, progress.message_id, `❌ Repo "${owner}/${name}" not found or private.`);
      return;
    }

    // 3. Run analysis
    info('repo', 'Analyzing', { owner, name });
    const analysis = await getAnalyzer().analyzeRepo(owner, name);
    info('repo', 'Analysis complete', { owner, name, verdict: analysis.verdict });

    // 4. Save to state
    const tracked = await saveTrackedRepo(owner, name, analysis, repoInfo.pushed_at);

    // 5. Show result
    await ctx.api.deleteMessage(ctx.chat!.id, progress.message_id);
    const msg = await ctx.reply(formatCard(tracked), {
      parse_mode: 'Markdown',
      reply_markup: repoKeyboard(tracked),
    });
    await stateManager.setMessageRepo(msg.message_id, owner, name);
    await stateManager.updateRepoMessageId(owner, name, msg.message_id);

    info('repo', 'Done', { owner, name, verdict: analysis.verdict });

  } catch (err) {
    logErr('repo', err, { input });
    await editProgress(ctx, progress.message_id, `❌ ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * Handle "More" button - show full details
 */
export async function handleRepoDetails(ctx: Context, owner: string, name: string): Promise<void> {
  info('repo.details', 'Showing details', { owner, name });

  try {
    const tracked = await stateManager.getTrackedRepo(owner, name);
    if (!tracked?.analysis) {
      await ctx.answerCallbackQuery({ text: 'Repo not found' });
      return;
    }

    await ctx.editMessageText(formatDetails(tracked), {
      parse_mode: 'Markdown',
      reply_markup: detailsKeyboard(tracked),
    });

  } catch (err) {
    logErr('repo.details', err, { owner, name });
    await ctx.answerCallbackQuery({ text: 'Error loading details' });
  }
}

/**
 * Handle "Back" button - return to card view
 */
export async function handleRepoBack(ctx: Context, owner: string, name: string): Promise<void> {
  info('repo.back', 'Returning to card', { owner, name });

  try {
    const tracked = await stateManager.getTrackedRepo(owner, name);
    if (!tracked) {
      await ctx.answerCallbackQuery({ text: 'Repo not found' });
      return;
    }

    await ctx.editMessageText(formatCard(tracked), {
      parse_mode: 'Markdown',
      reply_markup: repoKeyboard(tracked),
    });

  } catch (err) {
    logErr('repo.back', err, { owner, name });
    await ctx.answerCallbackQuery({ text: 'Error' });
  }
}

// ============ HELPERS ============

async function resolveRepo(input: string): Promise<{ owner: string; name: string }> {
  if (input.includes('/')) {
    const [owner, name] = input.split('/');
    return { owner, name };
  }

  // Search user's repos
  const repos = await getGitHub().getUserRepos();
  const found = repos.find(r => r.name.toLowerCase() === input.toLowerCase());
  if (!found) {
    throw new Error(`"${input}" not found. Use owner/name for external repos.`);
  }
  return { owner: found.full_name.split('/')[0], name: found.name };
}

async function saveTrackedRepo(
  owner: string,
  name: string,
  analysis: TrackedRepo['analysis'],
  pushedAt: string | null
): Promise<TrackedRepo> {
  const tracked: TrackedRepo = {
    id: `${owner}/${name}`,
    name,
    owner,
    state: verdictToState(analysis!.verdict),
    analysis,
    analyzed_at: new Date().toISOString(),
    pending_action: null,
    pending_since: null,
    last_message_id: null,
    last_push_at: pushedAt,
    killed_at: null,
    shipped_at: null,
    cover_image_url: null,
  };
  await stateManager.saveTrackedRepo(tracked);
  return tracked;
}

function verdictToState(verdict: string): TrackedRepo['state'] {
  switch (verdict) {
    case 'ship': return 'ready';
    case 'cut_to_core': return 'has_core';
    case 'no_core': return 'no_core';
    case 'dead': return 'dead';
    default: return 'unanalyzed';
  }
}

async function editProgress(ctx: Context, messageId: number, text: string): Promise<void> {
  try {
    await ctx.api.editMessageText(ctx.chat!.id, messageId, text);
  } catch {
    // Message may have been deleted
  }
}

// ============ KEYBOARDS ============

function repoKeyboard(repo: TrackedRepo): InlineKeyboard {
  const id = `${repo.owner}:${repo.name}`;
  const kb = new InlineKeyboard();
  const verdict = repo.analysis?.verdict;

  if (verdict === 'ship') {
    kb.text('🚀 Ship', `ship:${id}`);
    kb.text('☠️ Kill', `kill:${id}`);
  } else if (verdict === 'cut_to_core') {
    kb.text('✂️ Cut', `cut:${id}`);
    kb.text('☠️ Kill', `kill:${id}`);
  } else {
    kb.text('☠️ Kill', `kill:${id}`);
  }

  kb.row();
  kb.text('📋 More', `more:${id}`);

  return kb;
}

function detailsKeyboard(repo: TrackedRepo): InlineKeyboard {
  const id = `${repo.owner}:${repo.name}`;
  return new InlineKeyboard()
    .text('⬅️ Back', `back:${id}`)
    .text('🎨 Cover', `cover:${id}`);
}

