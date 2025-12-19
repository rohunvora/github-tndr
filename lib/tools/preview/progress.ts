/**
 * Preview Progress Module
 * 
 * Provides breadcrumb-style progress tracking for multi-phase operations.
 * Handles rate limiting to avoid Telegram API throttling, and formats
 * progress messages with Unicode box-drawing characters.
 * 
 * This pattern can be reused for other multi-step operations like:
 * - /repo analysis
 * - /scan batch processing
 * - /readme generation
 * 
 * @example
 * ```typescript
 * const tracker = await createProgressTracker(ctx, 'my-repo');
 * await updateProgress(tracker, 'resolving');
 * await updateProgress(tracker, 'fetching');
 * await updateProgress(tracker, 'analyzing', 'Claude Opus');
 * await completeProgress(tracker);
 * ```
 * 
 * Output:
 * ```
 * 🎨 my-repo
 * ├─ Resolving ✓
 * ├─ Fetching repo ✓
 * ├─ Analyzing (Claude Opus)...
 * ├─ Generating cover
 * ```
 */

import type { Context, Api } from 'grammy';

/** Minimum milliseconds between message edits to avoid rate limiting */
const MIN_EDIT_INTERVAL = 3000;

/** Phase status for display */
type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped';

/** Internal phase representation */
interface ProgressPhase {
  id: string;
  label: string;
  status: PhaseStatus;
  detail?: string;
}

/**
 * Progress tracker state
 * Passed between updateProgress calls to maintain state
 */
export interface ProgressTracker {
  /** Telegram chat ID */
  chatId: number;
  /** Progress message ID for editing */
  messageId: number;
  /** Display title (usually repo name) */
  title: string;
  /** Array of phases with their status */
  phases: ProgressPhase[];
  /** Currently active phase ID */
  currentPhase: string;
  /** Timestamp of last message edit (for rate limiting) */
  lastEditTime: number;
  /** Grammy API instance for editing messages */
  api: Api;
}

/** 
 * Phase configuration - maps phase IDs to display labels
 * Order matters: phases are displayed in this order
 */
const PHASE_CONFIG: Record<string, string> = {
  resolving: 'Resolving',
  fetching: 'Fetching repo',
  analyzing: 'Analyzing',
  generating: 'Generating cover',
  uploading: 'Uploading',
};

/**
 * Creates a new progress tracker and sends the initial progress message
 * 
 * @param ctx - Grammy context
 * @param title - Display title (usually repo name)
 * @returns ProgressTracker instance for subsequent updates
 */
export async function createProgressTracker(
  ctx: Context,
  title: string
): Promise<ProgressTracker> {
  const phases: ProgressPhase[] = Object.entries(PHASE_CONFIG).map(([id, label]) => ({
    id,
    label,
    status: 'pending' as PhaseStatus,
  }));

  // Mark first phase as active
  phases[0].status = 'active';

  const msg = await ctx.reply(formatProgress(title, phases), {
    parse_mode: 'Markdown',
  });

  return {
    chatId: ctx.chat!.id,
    messageId: msg.message_id,
    title,
    phases,
    currentPhase: phases[0].id,
    lastEditTime: Date.now(),
    api: ctx.api,
  };
}

/**
 * Updates the progress tracker to a new phase
 * Handles rate limiting to avoid Telegram API throttling
 * 
 * @param tracker - Progress tracker instance
 * @param phaseId - ID of the phase to advance to
 * @param detail - Optional detail to show (e.g., "Claude Opus")
 */
export async function updateProgress(
  tracker: ProgressTracker,
  phaseId: string,
  detail?: string
): Promise<void> {
  // Rate limit edits to avoid Telegram throttling
  const now = Date.now();
  if (now - tracker.lastEditTime < MIN_EDIT_INTERVAL) {
    // Still update internal state even if we don't edit
    updatePhaseStatuses(tracker, phaseId, detail);
    return;
  }

  updatePhaseStatuses(tracker, phaseId, detail);
  tracker.lastEditTime = now;

  // Edit message (fire and forget, ignore rate limit errors)
  try {
    await tracker.api.editMessageText(
      tracker.chatId,
      tracker.messageId,
      formatProgress(tracker.title, tracker.phases),
      { parse_mode: 'Markdown' }
    );
  } catch {
    // Rate limited or message deleted - ignore
  }
}

/**
 * Updates internal phase statuses
 */
function updatePhaseStatuses(
  tracker: ProgressTracker,
  phaseId: string,
  detail?: string
): void {
  const targetIndex = tracker.phases.findIndex((p) => p.id === phaseId);

  for (let i = 0; i < tracker.phases.length; i++) {
    const phase = tracker.phases[i];
    if (i < targetIndex) {
      // Previous phases are done
      if (phase.status !== 'skipped') {
        phase.status = 'done';
      }
    } else if (i === targetIndex) {
      // Current phase is active
      phase.status = 'active';
      phase.detail = detail;
    }
    // Future phases remain pending
  }

  tracker.currentPhase = phaseId;
}

/**
 * Marks a phase as skipped (e.g., when analysis already exists)
 * 
 * @param tracker - Progress tracker instance
 * @param phaseId - ID of the phase to skip
 */
export async function skipPhase(
  tracker: ProgressTracker,
  phaseId: string
): Promise<void> {
  const phase = tracker.phases.find((p) => p.id === phaseId);
  if (phase) {
    phase.status = 'skipped';
    phase.detail = 'cached';
  }
}

/**
 * Completes the progress tracking by deleting the progress message
 * Called before sending the final result (e.g., preview image)
 * 
 * @param tracker - Progress tracker instance
 */
export async function completeProgress(tracker: ProgressTracker): Promise<void> {
  try {
    await tracker.api.deleteMessage(tracker.chatId, tracker.messageId);
  } catch {
    // Already deleted - ignore
  }
}

/**
 * Marks progress as failed and updates the message with error
 * Shows a clear, copy-pasteable error message for debugging
 * 
 * @param tracker - Progress tracker instance
 * @param error - Error message to display
 */
export async function failProgress(
  tracker: ProgressTracker,
  error: string
): Promise<void> {
  // Format error for easy copy-paste debugging
  const timestamp = new Date().toISOString();
  const lastPhase = tracker.phases.find(p => p.status === 'active')?.id || 'unknown';
  
  const errorMsg = `❌ **${tracker.title}** failed

**Phase:** ${lastPhase}
**Error:** \`${error}\`
**Time:** ${timestamp}

_Copy this message to debug_`;

  try {
    await tracker.api.editMessageText(
      tracker.chatId,
      tracker.messageId,
      errorMsg,
      { parse_mode: 'Markdown' }
    );
  } catch {
    // Message deleted - ignore
  }
}

/**
 * Formats the progress message with Unicode box-drawing characters
 */
function formatProgress(title: string, phases: ProgressPhase[]): string {
  let msg = `🎨 **${title}**\n`;

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const isLast = i === phases.length - 1;
    const prefix = isLast ? '└─' : '├─';

    // Status icon
    let icon = '';
    if (phase.status === 'done') {
      icon = ' ✓';
    } else if (phase.status === 'active') {
      icon = '...';
    } else if (phase.status === 'skipped') {
      icon = ' ⏭';
    }

    // Optional detail
    const detail = phase.detail ? ` (${phase.detail})` : '';

    msg += `${prefix} ${phase.label}${detail}${icon}\n`;
  }

  return msg;
}

