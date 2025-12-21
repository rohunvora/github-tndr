/**
 * Skill System Types
 *
 * Universal interface for all commands/handlers.
 * Enables dependency injection, testability, and consistent patterns.
 */

import type { Context } from 'grammy';
import type { kv } from '@vercel/kv';
import type Anthropic from '@anthropic-ai/sdk';
import type { GitHubClient } from '../../core/github.js';

// ============ CORE SKILL INTERFACE ============

/**
 * Universal Skill interface
 *
 * Every command/handler becomes a Skill with:
 * - Typed input/output
 * - Declared dependencies
 * - Pure run() function (receives injected context)
 * - Optional progress callback
 * - Optional caching strategy
 */
export interface Skill<TInput, TOutput> {
  /** Unique skill identifier */
  name: string;

  /** Human-readable description */
  description: string;

  /** Required external services */
  dependencies: SkillDependency[];

  /** Progress steps for UI (optional) */
  progressSteps?: string[];

  /** Core execution - receives injected context */
  run(input: TInput, ctx: SkillContext): Promise<SkillResult<TOutput>>;

  /** Check if cached result exists (optional) */
  isCached?(input: TInput, ctx: SkillContext): Promise<boolean>;
}

// ============ DEPENDENCIES ============

export type SkillDependency = 'github' | 'anthropic' | 'gemini' | 'kv' | 'telegram';

// ============ SKILL CONTEXT ============

/**
 * Injected context for skill execution
 * All external dependencies are provided here for testability
 */
export interface SkillContext {
  /** GitHub API client */
  github: GitHubClient;

  /** Anthropic Claude client */
  anthropic: Anthropic;

  /** Google Gemini client */
  gemini: GoogleClient;

  /** Vercel KV store */
  kv: typeof kv;

  /** Telegram messaging adapter (abstracted for testability) */
  telegram: TelegramAdapter;

  /** Session management */
  sessions: SessionManager;

  /** Progress reporting callback */
  onProgress?: (step: string, detail?: string) => Promise<void>;
}

// ============ SKILL RESULT ============

export interface SkillResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
}

// ============ TELEGRAM ADAPTER ============

export interface MessageOptions {
  parse_mode?: 'Markdown' | 'HTML';
  reply_markup?: unknown;
  link_preview_options?: { is_disabled?: boolean };
}

export interface PhotoOptions extends MessageOptions {
  caption?: string;
}

export interface MessageResult {
  messageId: number;
}

/**
 * Abstracts Telegram operations for testability
 * In production: wraps grammy Context
 * In tests: logs calls or returns mocks
 */
export interface TelegramAdapter {
  /** Send text message */
  reply(text: string, options?: MessageOptions): Promise<MessageResult>;

  /** Edit existing message */
  editMessage(messageId: number, text: string, options?: MessageOptions): Promise<void>;

  /** Delete message */
  deleteMessage(messageId: number): Promise<void>;

  /** Send photo with optional caption */
  replyWithPhoto(photo: Buffer | string, caption?: string, options?: PhotoOptions): Promise<MessageResult>;

  /** Answer callback query (toast notification) */
  answerCallback(text?: string): Promise<void>;

  /** Show typing indicator */
  showTyping(): Promise<void>;

  /** Chat ID */
  readonly chatId: number;

  /** User ID */
  readonly userId: number;
}

// ============ SESSION MANAGER ============

export type SessionType = 'card' | 'preview' | 'readme' | 'scan';

export interface StoredSession<T> {
  id: string;
  type: SessionType;
  data: T;
  version: number;
  createdAt: string;
}

export interface SessionManager {
  /** Create new session with TTL */
  create<T>(type: SessionType, data: T, ttlSeconds: number): Promise<string>;

  /** Get session by ID */
  get<T>(id: string): Promise<StoredSession<T> | null>;

  /** Update session data (increments version, refreshes TTL) */
  update<T>(id: string, updates: Partial<T>): Promise<StoredSession<T>>;

  /** Delete session */
  delete(id: string): Promise<void>;

  /** Validate version matches */
  validateVersion(session: StoredSession<unknown>, expectedVersion: number): boolean;
}

// ============ GOOGLE CLIENT (Gemini) ============

export interface GoogleClientModels {
  generateContent(params: {
    model: string;
    contents: Array<{
      role: string;
      parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
    }>;
    config?: {
      temperature?: number;
      maxOutputTokens?: number;
      responseModalities?: string[];
    };
  }): Promise<{
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
      };
    }>;
  }>;
}

export interface GoogleClient {
  models: GoogleClientModels;
}

// ============ PROGRESS TRACKER ============

export interface ProgressOptions {
  /** Silent mode - no messages sent */
  mode?: 'normal' | 'silent';

  /** Delete progress message on completion */
  deleteOnComplete?: boolean;

  /** Throttle updates (ms) */
  throttleMs?: number;
}

export interface ProgressTracker {
  /** Send initial progress message */
  start(): Promise<void>;

  /** Advance to next step */
  advance(detail?: string): Promise<void>;

  /** Mark as complete (optionally delete message) */
  complete(): Promise<void>;

  /** Mark as failed with error */
  fail(error: string): Promise<void>;
}
