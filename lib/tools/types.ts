/**
 * Tool Interface
 * Standard contract that all tools must follow
 */

import type { Context } from 'grammy';

// ============ TOOL INTERFACE ============

export interface Tool {
  /** Unique identifier for this tool */
  name: string;
  
  /** Semantic version */
  version: string;
  
  /** Human-readable description */
  description: string;
  
  /** Commands this tool handles (e.g., /repo, /preview) */
  commands?: ToolCommand[];
  
  /** Message type handlers (e.g., photo for chart analysis) */
  messageHandlers?: MessageHandler[];
  
  /** Callback query handlers (e.g., button presses) */
  callbackHandlers?: CallbackHandler[];
  
  /** Called when tool is registered */
  init?: () => Promise<void>;
}

// ============ COMMAND HANDLER ============

export interface ToolCommand {
  /** Command name without slash (e.g., "repo", "preview") */
  name: string;
  
  /** Description shown in /help */
  description: string;
  
  /** Handler function */
  handler: CommandHandler;
}

export type CommandHandler = (ctx: Context, args: string) => Promise<void>;

// ============ MESSAGE HANDLER ============

export interface MessageHandler {
  /** Message type to handle */
  type: 'photo' | 'document' | 'text';
  
  /** Optional pattern for text messages */
  pattern?: RegExp;
  
  /** Priority (higher = checked first) */
  priority?: number;
  
  /** Handler function */
  handler: (ctx: Context) => Promise<void>;
}

// ============ CALLBACK HANDLER ============

export interface CallbackHandler {
  /** Pattern to match callback data */
  pattern: string | RegExp;
  
  /** Handler function */
  handler: (ctx: Context, data: string) => Promise<void>;
}

// ============ TOOL RESULT ============

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

