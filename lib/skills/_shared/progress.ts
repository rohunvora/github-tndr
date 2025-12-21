/**
 * Progress Tracker
 *
 * Unified progress tracking that works in both Telegram and CLI.
 * - Shows step-by-step progress with checkmarks
 * - Supports throttling to avoid Telegram rate limits
 * - Auto-deletes on completion (optional)
 */

import type { TelegramAdapter, ProgressOptions, ProgressTracker as IProgressTracker } from './types.js';

// ============ PROGRESS TRACKER IMPLEMENTATION ============

/**
 * Progress tracker that updates a Telegram message with step status
 */
export class ProgressTracker implements IProgressTracker {
  private messageId: number | null = null;
  private currentStep = -1;
  private lastUpdateTime = 0;
  private completed = false;

  constructor(
    private telegram: TelegramAdapter,
    private steps: string[],
    private options: ProgressOptions = {}
  ) {
    this.options = {
      mode: 'normal',
      deleteOnComplete: true,
      throttleMs: 500,
      ...options,
    };
  }

  /**
   * Send initial progress message
   */
  async start(): Promise<void> {
    if (this.options.mode === 'silent') return;

    this.currentStep = 0;
    const msg = await this.telegram.reply(this.formatProgress(), {
      parse_mode: 'Markdown',
    });
    this.messageId = msg.messageId;
    this.lastUpdateTime = Date.now();
  }

  /**
   * Advance to next step with optional detail
   */
  async advance(detail?: string): Promise<void> {
    if (this.options.mode === 'silent' || this.completed) return;

    this.currentStep++;

    // Throttle updates
    const now = Date.now();
    if (now - this.lastUpdateTime < (this.options.throttleMs ?? 500)) {
      return;
    }

    if (this.messageId) {
      await this.telegram.editMessage(this.messageId, this.formatProgress(detail), {
        parse_mode: 'Markdown',
      });
      this.lastUpdateTime = now;
    }
  }

  /**
   * Mark as complete
   */
  async complete(): Promise<void> {
    if (this.options.mode === 'silent' || this.completed) return;

    this.completed = true;

    if (this.messageId && this.options.deleteOnComplete) {
      await this.telegram.deleteMessage(this.messageId);
    }
  }

  /**
   * Mark as failed with error message
   */
  async fail(error: string): Promise<void> {
    if (this.options.mode === 'silent') return;

    this.completed = true;

    if (this.messageId) {
      await this.telegram.editMessage(this.messageId, `❌ ${error}`, {
        parse_mode: 'Markdown',
      });
    }
  }

  // ============ FORMATTING ============

  private formatProgress(detail?: string): string {
    return this.steps
      .map((step, i) => {
        if (i < this.currentStep) {
          return `✓ ${step}`;
        }
        if (i === this.currentStep) {
          const detailSuffix = detail ? `: ${detail}` : '';
          return `⏳ ${step}${detailSuffix}`;
        }
        return `○ ${step}`;
      })
      .join('\n');
  }
}

// ============ SILENT PROGRESS TRACKER ============

/**
 * No-op progress tracker for CLI/testing
 * Just tracks state internally without sending messages
 */
export class SilentProgressTracker implements IProgressTracker {
  private currentStep = -1;
  private stepDetails: string[] = [];

  constructor(private steps: string[]) {}

  async start(): Promise<void> {
    this.currentStep = 0;
  }

  async advance(detail?: string): Promise<void> {
    this.currentStep++;
    if (detail) {
      this.stepDetails.push(`${this.steps[this.currentStep]}: ${detail}`);
    }
  }

  async complete(): Promise<void> {
    this.currentStep = this.steps.length;
  }

  async fail(_error: string): Promise<void> {
    // Just marks as failed internally
  }

  // Test helpers
  getCurrentStep(): number {
    return this.currentStep;
  }

  getStepDetails(): string[] {
    return this.stepDetails;
  }
}

// ============ CLI PROGRESS TRACKER ============

/**
 * Console-based progress tracker for CLI scripts
 * Prints progress to stdout
 */
export class CLIProgressTracker implements IProgressTracker {
  private currentStep = -1;
  private startTime = 0;

  constructor(private steps: string[]) {}

  async start(): Promise<void> {
    this.currentStep = 0;
    this.startTime = Date.now();
    console.log(`\n${this.formatStep(0)}`);
  }

  async advance(detail?: string): Promise<void> {
    this.currentStep++;
    if (this.currentStep < this.steps.length) {
      console.log(this.formatStep(this.currentStep, detail));
    }
  }

  async complete(): Promise<void> {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`✓ Complete (${elapsed}s)\n`);
  }

  async fail(error: string): Promise<void> {
    console.error(`❌ Failed: ${error}\n`);
  }

  private formatStep(index: number, detail?: string): string {
    const step = this.steps[index];
    const detailSuffix = detail ? ` (${detail})` : '';
    return `⏳ ${step}${detailSuffix}...`;
  }
}

// ============ FACTORY ============

export type ProgressMode = 'telegram' | 'cli' | 'silent';

/**
 * Create appropriate progress tracker based on mode
 */
export function createProgressTracker(
  mode: ProgressMode,
  steps: string[],
  telegram?: TelegramAdapter,
  options?: ProgressOptions
): IProgressTracker {
  switch (mode) {
    case 'telegram':
      if (!telegram) {
        throw new Error('Telegram adapter required for telegram mode');
      }
      return new ProgressTracker(telegram, steps, options);

    case 'cli':
      return new CLIProgressTracker(steps);

    case 'silent':
      return new SilentProgressTracker(steps);

    default:
      return new SilentProgressTracker(steps);
  }
}
