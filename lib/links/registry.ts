/**
 * Link Registry
 * 
 * Central registry for smart link handlers.
 * Detects links in messages and routes to appropriate handlers.
 */

import type { Context } from 'grammy';
import type { LinkHandler, ParsedLink } from './types.js';
import { parseLinkCallback } from './types.js';
import { info, error as logErr } from '../core/logger.js';

class LinkRegistry {
  private handlers: Map<string, LinkHandler> = new Map();
  private sortedHandlers: LinkHandler[] = [];

  /**
   * Register a link handler
   */
  async register(handler: LinkHandler): Promise<void> {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Link handler "${handler.type}" is already registered`);
    }

    // Initialize if needed
    if (handler.init) {
      await handler.init();
    }

    this.handlers.set(handler.type, handler);
    
    // Rebuild sorted list (by priority, descending)
    this.sortedHandlers = Array.from(this.handlers.values())
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    info('links', `Registered link handler: ${handler.type}`, {
      name: handler.name,
      priority: handler.priority || 0,
    });
  }

  /**
   * Try to parse text as a link using registered handlers
   * Returns the first successful parse, or null
   */
  parse(text: string): { handler: LinkHandler; link: ParsedLink } | null {
    for (const handler of this.sortedHandlers) {
      // Quick match check first
      if (!handler.match(text)) continue;
      
      // Full parse
      const link = handler.parse(text);
      if (link) {
        return { handler, link };
      }
    }
    return null;
  }

  /**
   * Handle a text message that might be a link
   * Shows action menu if link is detected
   * 
   * @returns true if handled, false if not a recognized link
   */
  async handleMessage(ctx: Context, text: string): Promise<boolean> {
    const result = this.parse(text);
    if (!result) return false;

    const { handler, link } = result;
    
    try {
      info('links', `Detected ${handler.type} link`, { raw: link.raw.slice(0, 50) });

      // Get keyboard and message from handler
      const [keyboard, message] = await Promise.all([
        handler.getKeyboard(link, ctx),
        handler.formatMessage(link, ctx),
      ]);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true }, // Don't show preview, we have our own UI
      });

      return true;
    } catch (err) {
      logErr('links', err, { type: handler.type, raw: link.raw.slice(0, 50) });
      return false;
    }
  }

  /**
   * Handle a callback query for link actions
   * 
   * @returns true if handled, false if not a link callback
   */
  async handleCallback(ctx: Context, data: string): Promise<boolean> {
    const parsed = parseLinkCallback(data);
    if (!parsed) return false;

    const { type, action, parts } = parsed;
    const handler = this.handlers.get(type);
    
    if (!handler) {
      info('links', `Unknown link type in callback: ${type}`);
      return false;
    }

    try {
      info('links', `Handling ${type} action: ${action}`, { parts });
      
      // Reconstruct the link from callback data
      // Each handler is responsible for encoding/decoding its data in callbacks
      const link: ParsedLink = {
        type,
        raw: '', // Not available from callback
        data: parts, // Handler interprets this
      };

      await handler.handleAction({
        ctx,
        link,
        action,
        parts,
      });

      return true;
    } catch (err) {
      logErr('links', err, { type, action, parts });
      await ctx.answerCallbackQuery({ text: 'Error processing action' });
      return false;
    }
  }

  /**
   * Get a handler by type
   */
  getHandler(type: string): LinkHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * Get all registered handlers
   */
  getAllHandlers(): LinkHandler[] {
    return this.sortedHandlers;
  }
}

// Singleton instance
export const linkRegistry = new LinkRegistry();

/**
 * Register multiple link handlers at once
 */
export async function registerLinkHandlers(handlers: LinkHandler[]): Promise<void> {
  for (const handler of handlers) {
    await linkRegistry.register(handler);
  }
  info('links', `Registered ${handlers.length} link handlers`);
}

