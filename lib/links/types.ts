/**
 * Link Handler Types
 * 
 * Defines the interface for smart link detection and handling.
 * Similar to Tool registry but specifically for URL/link parsing.
 */

import type { Context } from 'grammy';
import type { InlineKeyboard } from 'grammy';

/**
 * Parsed link data - each handler defines its own shape
 */
export interface ParsedLink<T = unknown> {
  /** The link type (e.g., 'github', 'twitter', 'npm') */
  type: string;
  /** Original input text */
  raw: string;
  /** Handler-specific parsed data */
  data: T;
  /** Optional display label */
  label?: string;
}

/**
 * Context passed to action handlers
 */
export interface LinkActionContext<T = unknown> {
  /** Grammy context */
  ctx: Context;
  /** The parsed link data */
  link: ParsedLink<T>;
  /** The specific action being invoked */
  action: string;
  /** Callback data parts after the action prefix */
  parts: string[];
}

/**
 * Link Handler Definition
 * 
 * Implement this interface to add support for a new link type.
 * 
 * @example
 * ```typescript
 * export const githubLinkHandler: LinkHandler<GitHubLinkData> = {
 *   type: 'github',
 *   name: 'GitHub Repository',
 *   
 *   match: (text) => text.includes('github.com'),
 *   
 *   parse: (text) => {
 *     const match = text.match(/github\.com\/([^\/]+)\/([^\/]+)/);
 *     if (!match) return null;
 *     return { type: 'github', raw: text, data: { owner: match[1], name: match[2] } };
 *   },
 *   
 *   getKeyboard: async (link) => {
 *     return new InlineKeyboard().text('Analyze', `link_github_analyze:${link.data.owner}:${link.data.name}`);
 *   },
 *   
 *   formatMessage: async (link) => `**${link.data.owner}/${link.data.name}**`,
 *   
 *   handleAction: async ({ ctx, link, action }) => {
 *     if (action === 'analyze') { ... }
 *   },
 * };
 * ```
 */
export interface LinkHandler<T = unknown> {
  /** Unique identifier for this link type */
  type: string;
  
  /** Human-readable name */
  name: string;
  
  /** Optional description */
  description?: string;
  
  /** Priority for matching (higher = checked first). Default: 0 */
  priority?: number;
  
  /**
   * Quick check if this handler might match the text.
   * Should be fast - use for initial filtering before full parse.
   */
  match: (text: string) => boolean;
  
  /**
   * Parse the text and extract link data.
   * Return null if parsing fails.
   */
  parse: (text: string) => ParsedLink<T> | null;
  
  /**
   * Generate the action menu keyboard for this link.
   * Can be async to fetch additional context (e.g., check if repo is tracked).
   */
  getKeyboard: (link: ParsedLink<T>, ctx: Context) => Promise<InlineKeyboard>;
  
  /**
   * Format the message to show above the action menu.
   * Can be async to fetch additional context.
   */
  formatMessage: (link: ParsedLink<T>, ctx: Context) => Promise<string>;
  
  /**
   * Handle an action callback from the menu.
   * Action is the part after `link_{type}_` prefix.
   */
  handleAction: (context: LinkActionContext<T>) => Promise<void>;
  
  /**
   * Optional: Initialize handler (called once at startup)
   */
  init?: () => Promise<void>;
}

/**
 * Callback prefix format: link_{type}_{action}:{data}
 * Example: link_github_analyze:owner:repo
 */
export function formatLinkCallback(type: string, action: string, ...data: string[]): string {
  const base = `link_${type}_${action}`;
  return data.length > 0 ? `${base}:${data.join(':')}` : base;
}

/**
 * Parse a link callback string
 */
export function parseLinkCallback(data: string): { type: string; action: string; parts: string[] } | null {
  if (!data.startsWith('link_')) return null;
  
  const withoutPrefix = data.slice(5); // Remove 'link_'
  const firstColon = withoutPrefix.indexOf(':');
  const actionPart = firstColon === -1 ? withoutPrefix : withoutPrefix.slice(0, firstColon);
  const dataPart = firstColon === -1 ? '' : withoutPrefix.slice(firstColon + 1);
  
  // actionPart is like "github_analyze"
  const underscoreIdx = actionPart.indexOf('_');
  if (underscoreIdx === -1) return null;
  
  const type = actionPart.slice(0, underscoreIdx);
  const action = actionPart.slice(underscoreIdx + 1);
  const parts = dataPart ? dataPart.split(':') : [];
  
  return { type, action, parts };
}

