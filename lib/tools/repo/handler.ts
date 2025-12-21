/**
 * Repo Tool Telegram Handler
 */

import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { stateManager } from '../../core/state.js';
import { GitHubClient } from '../../core/github.js';
import type { TrackedRepo } from '../../core/types.js';
import { repoSkill } from '../../skills/repo/index.js';
import { formatCard, formatDetails, formatProgressMessage } from './format.js';

// Progress state
type Phase = 'resolving' | 'fetching' | 'analyzing' | 'formatting' | 'done';

interface ProgressState {
  messageId: number;
  chatId: number;
  input: string;
  phase: Phase;
  lastEditTime: number;
  phaseStartTime: number;
}

const MIN_EDIT_INTERVAL = 5000;

// GitHub client singleton
let github: GitHubClient | null = null;

function getGitHub(): GitHubClient {
  if (!github) {
    github = new GitHubClient(process.env.GITHUB_TOKEN!);
  }
  return github;
}

async function updateProgress(
  ctx: Context,
  state: ProgressState,
  newPhase: Phase,
  force = false
): Promise<void> {
  const now = Date.now();
  const elapsed = now - state.phaseStartTime;
  
  const phaseChanged = newPhase !== state.phase;
  const heartbeatNeeded = elapsed > 10000 && (now - state.lastEditTime > MIN_EDIT_INTERVAL);
  
  if (!phaseChanged && !force && !heartbeatNeeded) return;
  if (!phaseChanged && (now - state.lastEditTime < MIN_EDIT_INTERVAL)) return;
  
  state.phase = newPhase;
  state.lastEditTime = now;
  if (phaseChanged) state.phaseStartTime = now;
  
  try {
    await ctx.api.editMessageText(
      state.chatId,
      state.messageId,
      formatProgressMessage(state.input, newPhase, elapsed),
      { parse_mode: 'Markdown' }
    );
  } catch {
    // Rate limited or message deleted
  }
}

/**
 * Handle /repo command
 */
export async function handleRepoCommand(ctx: Context, input: string): Promise<void> {
  if (!input) {
    await ctx.reply('Usage: `/repo <name>` or `/repo owner/name`', { parse_mode: 'Markdown' });
    return;
  }

  info('repo', 'Starting', { input });

  // Idempotency lock
  const lockKey = `analyzing:${input.toLowerCase()}`;
  const existingLock = await stateManager.get(lockKey);
  if (existingLock) {
    info('repo', 'Already analyzing, skipping', { input });
    return;
  }
  await stateManager.set(lockKey, 'true', 120);

  // Progress message
  const progress = await ctx.reply(formatProgressMessage(input, 'resolving'), { parse_mode: 'Markdown' });
  
  const state: ProgressState = {
    messageId: progress.message_id,
    chatId: ctx.chat!.id,
    input,
    phase: 'resolving',
    lastEditTime: Date.now(),
    phaseStartTime: Date.now(),
  };

  try {
    // Resolve repo
    const { owner, name } = await resolveRepo(input);
    info('repo', 'Resolved', { owner, name });
    await updateProgress(ctx, state, 'fetching');

    // Fetch info to validate repo exists
    const repoInfo = await getGitHub().getRepoInfo(owner, name);
    if (!repoInfo) {
      await ctx.api.editMessageText(state.chatId, state.messageId, `❌ "${owner}/${name}" not found or private.`);
      return;
    }
    await updateProgress(ctx, state, 'analyzing');

    // Run analysis using skill
    info('repo', 'Analyzing via skill', { owner, name });
    const skillResult = await repoSkill.run({
      owner,
      name,
      forceRefresh: true, // Always fresh analysis for command
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
      throw new Error(skillResult.error || 'Analysis failed');
    }

    const { analysis, trackedRepo: tracked, cardMessage } = skillResult.data!;
    info('repo', 'Analysis complete', { owner, name, verdict: analysis.verdict });
    await updateProgress(ctx, state, 'formatting');

    // Delete progress, send card
    await ctx.api.deleteMessage(state.chatId, state.messageId);
    const msg = await ctx.reply(cardMessage, {
      parse_mode: 'Markdown',
      reply_markup: repoKeyboard(tracked),
    });
    await stateManager.setMessageRepo(msg.message_id, owner, name);
    await stateManager.updateRepoMessageId(owner, name, msg.message_id);

    info('repo', 'Done', { owner, name, verdict: analysis.verdict });

  } catch (err) {
    logErr('repo', err, { input });
    try {
      await ctx.api.editMessageText(state.chatId, state.messageId, `❌ ${err instanceof Error ? err.message : 'Unknown error'}`);
    } catch {
      // Message may have been deleted
    }
  } finally {
    await stateManager.delete(lockKey);
  }
}

/**
 * Handle "More" callback - show details
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
    await ctx.answerCallbackQuery();

  } catch (err) {
    logErr('repo.details', err, { owner, name });
    await ctx.answerCallbackQuery({ text: 'Error loading details' });
  }
}

/**
 * Handle "Back" callback - return to card
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
    await ctx.answerCallbackQuery();

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

  const repos = await getGitHub().getUserRepos();
  const found = repos.find(r => r.name.toLowerCase() === input.toLowerCase());
  if (!found) {
    throw new Error(`"${input}" not found. Use owner/name for external repos.`);
  }
  return { owner: found.full_name.split('/')[0], name: found.name };
}

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

