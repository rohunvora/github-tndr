/**
 * Preview Feedback Module
 * 
 * Handles the reject → feedback → regenerate cycle for preview images.
 * 
 * Uses Telegram's ForceReply to guide the user to respond immediately.
 * Feedback state is stored briefly (2 minutes) - if user doesn't respond
 * quickly, they can just run /preview again.
 * 
 * Design principles:
 * - Force immediate interaction (ForceReply)
 * - Short TTL (2 min) - not 30 minutes of stale state
 * - Simple KV lookup only when user replies to bot message
 */

import type { Context } from 'grammy';
import { InputFile, InlineKeyboard } from 'grammy';
import { kv } from '@vercel/kv';
import { getSession, updateSession } from './sessions.js';
import { generateCoverImage } from './generator.js';
import { stateManager } from '../../core/state.js';
import { info, error as logErr } from '../../core/logger.js';

/** Very short TTL - user should respond immediately */
const FEEDBACK_TTL = 120; // 2 minutes

/** Key prefix for pending feedback */
const FEEDBACK_PREFIX = 'preview_feedback:';

/**
 * Pending feedback state - minimal data needed
 */
interface PendingFeedback {
  sessionId: string;
  promptMessageId: number;
}

/**
 * Handles the Reject button callback
 * 
 * Sends a ForceReply message that guides the user to respond immediately.
 * The Telegram client will show a reply interface focused on this message.
 * 
 * @param ctx - Grammy callback query context
 * @param sessionId - Preview session ID
 */
export async function handleRejectButton(ctx: Context, sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'Session expired - run /preview again' });
    return;
  }

  await ctx.answerCallbackQuery();

  info('preview.feedback', 'Reject clicked', { 
    sessionId, 
    attempt: session.attempt,
  });

  // Send feedback prompt with ForceReply
  // This makes Telegram client show reply UI automatically
  const promptMsg = await ctx.reply(
    `📝 **What should change?**\n\n` +
    `Reply now with your feedback, e.g.:\n` +
    `• _"Make it darker, more terminal-like"_\n` +
    `• _"Show the product name bigger"_\n` +
    `• _"Use blue colors instead"_\n\n` +
    `⏱ _Reply within 2 minutes_`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        force_reply: true,
        selective: true,
        input_field_placeholder: 'Describe what to change...',
      },
    }
  );

  // Store minimal state with short TTL
  // Key is the prompt message ID - when user replies, we look this up
  await kv.set(
    `${FEEDBACK_PREFIX}${promptMsg.message_id}`,
    { sessionId, promptMessageId: promptMsg.message_id } as PendingFeedback,
    { ex: FEEDBACK_TTL }
  );

  info('preview.feedback', 'Feedback prompt sent', { 
    sessionId, 
    promptMessageId: promptMsg.message_id,
  });
}

/**
 * Checks if a text message is a feedback reply and handles it
 * 
 * This should be called early in the text message handler.
 * Only triggers if the message is a reply to a known feedback prompt.
 * 
 * @param ctx - Grammy message context
 * @returns true if this was feedback and was handled, false otherwise
 */
export async function handleFeedbackReply(ctx: Context): Promise<boolean> {
  // Only process if this is a reply to another message
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId) return false;

  // Check if this is a reply to a feedback prompt (short-lived key)
  const pending = await kv.get<PendingFeedback>(`${FEEDBACK_PREFIX}${replyToId}`);
  if (!pending) return false;

  const feedbackText = ctx.message!.text;
  if (!feedbackText) return false;

  info('preview.feedback', 'Feedback received', { 
    sessionId: pending.sessionId, 
    feedback: feedbackText.slice(0, 100),
  });

  // Clean up the pending feedback key immediately
  await kv.del(`${FEEDBACK_PREFIX}${replyToId}`);

  // Get session
  const session = await getSession(pending.sessionId);
  if (!session) {
    await ctx.reply('⏰ Session expired. Run `/preview` again.', { parse_mode: 'Markdown' });
    return true;
  }

  // Update session with feedback
  const updatedFeedback = [...session.feedback, feedbackText];
  const newAttempt = session.attempt + 1;
  
  await updateSession(pending.sessionId, {
    feedback: updatedFeedback,
    attempt: newAttempt,
  });

  // Show regenerating status
  const statusMsg = await ctx.reply(
    `🔄 **Regenerating...**\n📝 _"${truncate(feedbackText, 80)}"_`,
    { parse_mode: 'Markdown' }
  );

  try {
    // Get repo and regenerate
    const repo = await stateManager.getTrackedRepo(session.owner, session.name);
    if (!repo?.analysis) {
      throw new Error('Repo analysis not found');
    }

    const newImage = await generateCoverImage(repo, updatedFeedback);

    // Update session with new image
    await updateSession(pending.sessionId, {
      imageBase64: newImage.toString('base64'),
    });

    // Delete status message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    } catch { /* ignore */ }

    // Send new preview
    await sendPreviewImage(ctx, newImage, session.name, pending.sessionId, newAttempt, feedbackText);

    info('preview.feedback', 'Regeneration complete', { 
      sessionId: pending.sessionId, 
      attempt: newAttempt,
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logErr('preview.feedback', err, { sessionId: pending.sessionId });

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ **Regeneration failed**\n\n${errorMessage}\n\nTry again with \`/preview ${session.name}\``,
        { parse_mode: 'Markdown' }
      );
    } catch { /* ignore */ }
  }

  return true;
}

/**
 * Sends a preview image with approval buttons
 * 
 * @param ctx - Grammy context
 * @param imageBuffer - Image to send
 * @param name - Repo name for caption
 * @param sessionId - Session ID for button callbacks
 * @param attempt - Current attempt number
 * @param lastFeedback - Most recent feedback (shown in caption)
 */
export async function sendPreviewImage(
  ctx: Context,
  imageBuffer: Buffer,
  name: string,
  sessionId: string,
  attempt: number,
  lastFeedback?: string
): Promise<void> {
  const attemptText = attempt > 1 ? ` (attempt ${attempt})` : '';
  const feedbackText = lastFeedback ? `\n📝 _${truncate(lastFeedback, 60)}_` : '';

  const caption = `🎨 **${name}**${attemptText}${feedbackText}`;

  const keyboard = new InlineKeyboard()
    .text('✅ Approve', `preview_approve:${sessionId}`)
    .text('🔄 Reject', `preview_reject:${sessionId}`)
    .row()
    .text('❌ Cancel', `preview_cancel:${sessionId}`);

  await ctx.replyWithPhoto(new InputFile(imageBuffer, `${name}-cover.png`), {
    caption,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Truncates a string to a maximum length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
