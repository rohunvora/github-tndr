/**
 * Telegram Adapter
 *
 * Abstracts Telegram operations for testability.
 * - GrammyTelegramAdapter: Production wrapper around grammy Context
 * - MockTelegramAdapter: Test double that records all calls
 */

import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import type { TelegramAdapter, MessageOptions, PhotoOptions, MessageResult } from './types.js';

// ============ PRODUCTION ADAPTER ============

/**
 * Production adapter wrapping grammy Context
 */
export class GrammyTelegramAdapter implements TelegramAdapter {
  readonly chatId: number;
  readonly userId: number;

  constructor(private ctx: Context) {
    this.chatId = ctx.chat?.id ?? 0;
    this.userId = ctx.from?.id ?? 0;
  }

  async reply(text: string, options?: MessageOptions): Promise<MessageResult> {
    const msg = await this.ctx.reply(text, {
      parse_mode: options?.parse_mode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reply_markup: options?.reply_markup as any,
      link_preview_options: options?.link_preview_options,
    });
    return { messageId: msg.message_id };
  }

  async editMessage(messageId: number, text: string, options?: MessageOptions): Promise<void> {
    try {
      await this.ctx.api.editMessageText(this.chatId, messageId, text, {
        parse_mode: options?.parse_mode,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reply_markup: options?.reply_markup as any,
        link_preview_options: options?.link_preview_options,
      });
    } catch {
      // Swallow edit errors (rate limits, message deleted, etc.)
    }
  }

  async deleteMessage(messageId: number): Promise<void> {
    try {
      await this.ctx.api.deleteMessage(this.chatId, messageId);
    } catch {
      // Swallow delete errors (already deleted, etc.)
    }
  }

  async replyWithPhoto(
    photo: Buffer | string,
    caption?: string,
    options?: PhotoOptions
  ): Promise<MessageResult> {
    const photoInput = Buffer.isBuffer(photo) ? new InputFile(photo, 'image.png') : photo;

    const msg = await this.ctx.replyWithPhoto(photoInput, {
      caption: caption ?? options?.caption,
      parse_mode: options?.parse_mode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reply_markup: options?.reply_markup as any,
    });
    return { messageId: msg.message_id };
  }

  async answerCallback(text?: string): Promise<void> {
    try {
      await this.ctx.answerCallbackQuery({ text });
    } catch {
      // Swallow callback errors
    }
  }

  async showTyping(): Promise<void> {
    try {
      await this.ctx.api.sendChatAction(this.chatId, 'typing');
    } catch {
      // Swallow typing indicator errors
    }
  }
}

// ============ MOCK ADAPTER FOR TESTING ============

export interface MockCall {
  method: string;
  args: unknown[];
  timestamp: number;
}

/**
 * Mock adapter that records all calls for test assertions
 */
export class MockTelegramAdapter implements TelegramAdapter {
  readonly chatId: number;
  readonly userId: number;
  readonly calls: MockCall[] = [];

  private messageCounter = 1000;

  constructor(options?: { chatId?: number; userId?: number }) {
    this.chatId = options?.chatId ?? 12345;
    this.userId = options?.userId ?? 67890;
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args, timestamp: Date.now() });
  }

  async reply(text: string, options?: MessageOptions): Promise<MessageResult> {
    this.record('reply', [text, options]);
    return { messageId: this.messageCounter++ };
  }

  async editMessage(messageId: number, text: string, options?: MessageOptions): Promise<void> {
    this.record('editMessage', [messageId, text, options]);
  }

  async deleteMessage(messageId: number): Promise<void> {
    this.record('deleteMessage', [messageId]);
  }

  async replyWithPhoto(
    photo: Buffer | string,
    caption?: string,
    options?: PhotoOptions
  ): Promise<MessageResult> {
    // Don't record full buffer, just metadata
    const photoInfo = Buffer.isBuffer(photo)
      ? `<Buffer ${photo.length} bytes>`
      : photo;
    this.record('replyWithPhoto', [photoInfo, caption, options]);
    return { messageId: this.messageCounter++ };
  }

  async answerCallback(text?: string): Promise<void> {
    this.record('answerCallback', [text]);
  }

  async showTyping(): Promise<void> {
    this.record('showTyping', []);
  }

  // ============ TEST HELPERS ============

  /** Get all calls to a specific method */
  getCalls(method: string): MockCall[] {
    return this.calls.filter(c => c.method === method);
  }

  /** Get last call to a method */
  getLastCall(method: string): MockCall | undefined {
    const calls = this.getCalls(method);
    return calls[calls.length - 1];
  }

  /** Check if method was called */
  wasCalled(method: string): boolean {
    return this.calls.some(c => c.method === method);
  }

  /** Clear all recorded calls */
  reset(): void {
    this.calls.length = 0;
  }

  /** Get summary of all calls for debugging */
  summary(): string {
    return this.calls
      .map(c => {
        const argsPreview = JSON.stringify(c.args).slice(0, 100);
        return `${c.method}(${argsPreview}${argsPreview.length >= 100 ? '...' : ''})`;
      })
      .join('\n');
  }
}
