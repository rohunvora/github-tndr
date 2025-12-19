/**
 * Next Tool Handler
 * Carousel navigation for project selection
 */

import type { Context } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { getProjectCandidates, type ProjectCandidate } from './selector.js';
import {
  formatCarouselCard,
  formatNoProjects,
  formatSelected,
  carouselKeyboard,
} from './format.js';
import { acquireLock, releaseLock } from '../../core/update-guard.js';

// Store carousel sessions
interface CarouselSession {
  candidates: ProjectCandidate[];
  currentIndex: number;
  messageId: number;
  chatId: number;
}

const sessions = new Map<string, CarouselSession>();

/**
 * Handle /next command
 */
export async function handleNextCommand(ctx: Context): Promise<void> {
  // Layer 2: Command-level lock prevents concurrent /next card generation
  const lockKey = `next:${ctx.chat!.id}`;
  if (!await acquireLock(lockKey, 60)) {  // 1 min TTL (next is faster than preview)
    await ctx.reply('⏳ Already finding your next task...');
    return;
  }

  info('next', '/next');

  try {
    // Get candidates
    const candidates = await getProjectCandidates();

    if (candidates.length === 0) {
      await ctx.reply(formatNoProjects(), { parse_mode: 'Markdown' });
      return;
    }

    // Create session
    const sessionId = `next_${Date.now()}`;
    const session: CarouselSession = {
      candidates,
      currentIndex: 0,
      messageId: 0,
      chatId: ctx.chat!.id,
    };

    // Send first card
    const msg = await ctx.reply(
      formatCarouselCard(candidates[0], 0, candidates.length),
      {
        parse_mode: 'Markdown',
        reply_markup: carouselKeyboard(sessionId, 0, candidates.length),
      }
    );

    session.messageId = msg.message_id;
    sessions.set(sessionId, session);

    info('next', 'Carousel started', { sessionId, total: candidates.length });

  } catch (err) {
    logErr('next', err);
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    const timestamp = new Date().toISOString();
    await ctx.reply(
      `❌ **/next** failed\n\n` +
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
 * Handle prev button
 */
export async function handlePrev(ctx: Context, sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'Session expired' });
    return;
  }

  if (session.currentIndex > 0) {
    session.currentIndex--;
    await updateCarousel(ctx, session, sessionId);
  }

  await ctx.answerCallbackQuery();
}

/**
 * Handle next button
 */
export async function handleNext(ctx: Context, sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'Session expired' });
    return;
  }

  if (session.currentIndex < session.candidates.length - 1) {
    session.currentIndex++;
    await updateCarousel(ctx, session, sessionId);
  }

  await ctx.answerCallbackQuery();
}

/**
 * Handle select button
 */
export async function handleSelect(ctx: Context, sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'Session expired' });
    return;
  }

  const candidate = session.candidates[session.currentIndex];
  const repoName = candidate.repo.name;

  // Clean up session
  sessions.delete(sessionId);

  await ctx.answerCallbackQuery({ text: `Selected: ${repoName}` });
  await ctx.editMessageText(formatSelected(repoName), { parse_mode: 'Markdown' });

  info('next', 'Project selected', { repo: repoName });
}

/**
 * Update carousel display
 */
async function updateCarousel(
  ctx: Context,
  session: CarouselSession,
  sessionId: string
): Promise<void> {
  const { candidates, currentIndex } = session;
  const candidate = candidates[currentIndex];

  await ctx.editMessageText(
    formatCarouselCard(candidate, currentIndex, candidates.length),
    {
      parse_mode: 'Markdown',
      reply_markup: carouselKeyboard(sessionId, currentIndex, candidates.length),
    }
  );
}

