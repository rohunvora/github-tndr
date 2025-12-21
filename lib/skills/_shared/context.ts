/**
 * Skill Context Factory
 *
 * Creates SkillContext with lazy-initialized clients.
 * All clients are singletons within a request.
 *
 * Usage:
 *   // In Telegram handler:
 *   const ctx = createSkillContext(telegramCtx);
 *   await someSkill.run(input, ctx);
 *
 *   // In CLI test:
 *   const ctx = createTestContext();
 *   await someSkill.run(input, ctx);
 */

import type { Context } from 'grammy';
import { kv } from '@vercel/kv';
import type Anthropic from '@anthropic-ai/sdk';
import type { GoogleGenAI } from '@google/genai';
import type { SkillContext, TelegramAdapter, SessionManager, GoogleClient } from './types.js';
import type { GitHubClient } from '../../core/github.js';
import { GrammyTelegramAdapter, MockTelegramAdapter } from './telegram-adapter.js';
import { KVSessionManager, MockSessionManager } from './sessions.js';
import { getAnthropicClient, getGoogleClient } from '../../core/config.js';
import { GitHubClient as GHClient } from '../../core/github.js';

// ============ PRODUCTION CONTEXT ============

/**
 * Creates SkillContext for production use (with real clients)
 */
export function createSkillContext(
  telegramCtx?: Context,
  overrides?: Partial<SkillContext>
): SkillContext {
  // Lazy client initialization
  let _github: GitHubClient | null = null;
  let _anthropic: Anthropic | null = null;
  let _gemini: GoogleGenAI | null = null;

  const context: SkillContext = {
    // Lazy GitHub client
    get github(): GitHubClient {
      if (!_github) {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          throw new Error('GITHUB_TOKEN not configured');
        }
        _github = new GHClient(token);
      }
      return _github;
    },

    // Lazy Anthropic client
    get anthropic(): Anthropic {
      if (!_anthropic) {
        _anthropic = getAnthropicClient();
      }
      return _anthropic;
    },

    // Lazy Gemini client (cast to GoogleClient interface)
    get gemini(): GoogleClient {
      if (!_gemini) {
        _gemini = getGoogleClient();
      }
      return _gemini as unknown as GoogleClient;
    },

    // KV store
    kv,

    // Telegram adapter
    telegram: telegramCtx
      ? new GrammyTelegramAdapter(telegramCtx)
      : new MockTelegramAdapter(),

    // Session manager
    sessions: new KVSessionManager(kv),

    // Override with any provided values
    ...overrides,
  };

  return context;
}

// ============ TEST CONTEXT ============

export interface TestContextOptions {
  /** Mock Telegram adapter options */
  telegram?: {
    chatId?: number;
    userId?: number;
  };

  /** Custom mock clients */
  mocks?: {
    github?: Partial<GitHubClient>;
    anthropic?: Partial<Anthropic>;
    gemini?: Partial<GoogleClient>;
  };
}

/**
 * Creates SkillContext for testing (with mock clients)
 * No external dependencies required
 */
export function createTestContext(options?: TestContextOptions): SkillContext {
  const mockTelegram = new MockTelegramAdapter(options?.telegram);
  const mockSessions = new MockSessionManager();

  // Create mock KV that uses in-memory storage
  const mockKV = createMockKV();

  return {
    github: createMockGitHub(options?.mocks?.github),
    anthropic: createMockAnthropic(options?.mocks?.anthropic),
    gemini: createMockGemini(options?.mocks?.gemini),
    kv: mockKV,
    telegram: mockTelegram,
    sessions: mockSessions,
  };
}

// ============ MOCK FACTORIES ============

function createMockKV(): SkillContext['kv'] {
  const store = new Map<string, { value: unknown; expiry?: number }>();

  return {
    get: async <T>(key: string): Promise<T | null> => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiry && Date.now() > entry.expiry) {
        store.delete(key);
        return null;
      }
      return entry.value as T;
    },
    set: async (key: string, value: unknown, options?: { ex?: number }) => {
      const expiry = options?.ex ? Date.now() + options.ex * 1000 : undefined;
      store.set(key, { value, expiry });
      return 'OK';
    },
    del: async (key: string) => {
      store.delete(key);
      return 1;
    },
    // Add other methods as needed
  } as SkillContext['kv'];
}

function createMockGitHub(overrides?: Partial<GitHubClient>): GitHubClient {
  return {
    getRepoInfo: async () => null,
    getFileContent: async () => null,
    getRepoTree: async () => [],
    getUserRepos: async () => [],
    getRecentRepos: async () => [],
    getCommitSignals: async () => ({
      last_commit_date: null,
      commit_count_30d: 0,
      recent_authors: [],
    }),
    updateFile: async () => {},
    ...overrides,
  } as GitHubClient;
}

function createMockAnthropic(overrides?: Partial<Anthropic>): Anthropic {
  return {
    messages: {
      create: async () => ({
        id: 'mock-msg-id',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: '{}' }],
        model: 'mock-model',
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    },
    ...overrides,
  } as unknown as Anthropic;
}

function createMockGemini(overrides?: Partial<GoogleClient>): GoogleClient {
  // Valid mock chart analysis response
  const mockChartAnalysis = JSON.stringify({
    story: 'Mock chart analysis - price moved from support to resistance.',
    currentContext: 'Currently testing near resistance.',
    keyZones: [
      { price: 100, label: 'Support', significance: 'Mock support level', type: 'support', strength: 'strong' },
      { price: 150, label: 'Resistance', significance: 'Mock resistance level', type: 'resistance', strength: 'moderate' },
    ],
    scenarios: [
      { condition: 'If price breaks above 150', implication: 'Bullish continuation expected' },
      { condition: 'If price falls below 100', implication: 'Bearish breakdown likely' },
    ],
    invalidation: 'Close below 90 invalidates the setup',
    regime: { type: 'ranging', confidence: 0.8 },
    currentPrice: 125,
    symbol: 'MOCK',
    timeframe: '1H',
  });

  // Mock image data (tiny 1x1 transparent PNG in base64)
  const mockImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  return {
    models: {
      generateContent: async (params) => {
        // Check if this is an image generation request
        const isImageGen = params.config?.responseModalities?.includes('IMAGE');

        if (isImageGen) {
          return {
            candidates: [{
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: mockImageBase64 } }],
              },
            }],
          };
        }

        // Text analysis response
        return {
          candidates: [{
            content: {
              parts: [{ text: mockChartAnalysis }],
            },
          }],
        };
      },
    },
    ...overrides,
  } as GoogleClient;
}

// ============ CONTEXT HELPERS ============

/**
 * Check if context has required dependencies for a skill
 */
export function validateDependencies(
  ctx: SkillContext,
  required: Array<'github' | 'anthropic' | 'gemini' | 'kv' | 'telegram'>
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const dep of required) {
    try {
      // Access the getter to trigger initialization check
      const value = ctx[dep];
      if (!value) {
        missing.push(dep);
      }
    } catch {
      missing.push(dep);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get the mock telegram adapter from context (for test assertions)
 */
export function getMockTelegram(ctx: SkillContext): MockTelegramAdapter | null {
  if (ctx.telegram instanceof MockTelegramAdapter) {
    return ctx.telegram;
  }
  return null;
}

/**
 * Get the mock session manager from context (for test assertions)
 */
export function getMockSessions(ctx: SkillContext): MockSessionManager | null {
  if (ctx.sessions instanceof MockSessionManager) {
    return ctx.sessions;
  }
  return null;
}
