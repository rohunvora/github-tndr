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

// Progress state for factual updates
type Phase = 'resolving' | 'fetching' | 'analyzing' | 'formatting' | 'done';

interface ProgressState {
  messageId: number;
  chatId: number;
  input: string;
  phase: Phase;
  lastEditTime: number;
  phaseStartTime: number;
}

const MIN_EDIT_INTERVAL = 5000; // 5 seconds minimum between edits
const HEARTBEAT_THRESHOLD = 10000; // Show "still working" after 10s

function formatProgressMessage(input: string, phase: Phase, elapsed?: number): string {
  const phases: Record<Phase, string> = {
    resolving: '⏳ resolving repo...',
    fetching: '✓ resolved\n⏳ fetching repo data...',
    analyzing: '✓ resolved\n✓ fetched\n⏳ running analysis...',
    formatting: '✓ resolved\n✓ fetched\n✓ analyzed\n⏳ formatting...',
    done: '✓ resolved\n✓ fetched\n✓ analyzed\n✓ done',
  };
  
  let msg = `🔍 **${input}**\n\n${phases[phase]}`;
  
  // Show "still working" if phase is taking long
  if (elapsed && elapsed > HEARTBEAT_THRESHOLD && phase !== 'done') {
    msg += `\n_still working..._`;
  }
  
  return msg;
}

async function updateProgress(
  ctx: Context,
  state: ProgressState,
  newPhase: Phase,
  force: boolean = false
): Promise<void> {
  const now = Date.now();
  const elapsed = now - state.phaseStartTime;
  
  // Only update if: phase changed, OR forced, OR heartbeat needed
  const phaseChanged = newPhase !== state.phase;
  const heartbeatNeeded = elapsed > HEARTBEAT_THRESHOLD && (now - state.lastEditTime > MIN_EDIT_INTERVAL);
  
  if (!phaseChanged && !force && !heartbeatNeeded) return;
  
  // Enforce min edit interval (unless phase changed)
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
 * Shows factual progress phases, min 5s edit interval
 * Uses idempotency lock to prevent duplicate analyses from webhook retries
 */
export async function handleRepo(ctx: Context, input: string): Promise<void> {
  info('repo', 'Starting', { input });

  // Idempotency: check if already analyzing this repo
  const lockKey = `analyzing:${input.toLowerCase()}`;
  const existingLock = await stateManager.get(lockKey);
  if (existingLock) {
    info('repo', 'Already analyzing, skipping duplicate', { input });
    return; // Don't send duplicate messages
  }
  // Set lock with 2-minute TTL (covers worst-case analysis time)
  await stateManager.set(lockKey, 'true', 120);

  // Show initial progress
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
    // Phase 1: Resolve
    const { owner, name } = await resolveRepo(input);
    info('repo', 'Resolved', { owner, name });
    await updateProgress(ctx, state, 'fetching');

    // Phase 2: Fetch
    const repoInfo = await getGitHub().getRepoInfo(owner, name);
    if (!repoInfo) {
      await ctx.api.editMessageText(state.chatId, state.messageId, `❌ "${owner}/${name}" not found or private.`);
      return;
    }
    await updateProgress(ctx, state, 'analyzing');

    // Phase 3: Analyze (longest phase - may trigger heartbeat)
    info('repo', 'Analyzing', { owner, name });
    const analysis = await getAnalyzer().analyzeRepo(owner, name);
    info('repo', 'Analysis complete', { owner, name, verdict: analysis.verdict });
    await updateProgress(ctx, state, 'formatting');

    // Phase 4: Save & format
    const tracked = await saveTrackedRepo(owner, name, analysis, repoInfo.pushed_at);

    // Auto-watch this repo for push notifications
    const fullName = `${owner}/${name}`;
    await stateManager.addWatchedRepo(fullName);
    info('repo', 'Auto-watched', { fullName });

    // Show final result (delete progress, send card)
    await ctx.api.deleteMessage(state.chatId, state.messageId);
    const msg = await ctx.reply(formatCard(tracked), {
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
    // Always release the lock
    const lockKey = `analyzing:${input.toLowerCase()}`;
    await stateManager.delete(lockKey);
  }
}

/**
 * Handle "More" button - show full details view
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
 * Handle "Back" button - return to card view (repo-canonical navigation)
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
    homepage: null,
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

