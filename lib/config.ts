/**
 * Unified AI Configuration
 * 
 * Centralizes all AI provider configuration and provides a router
 * to pick the right model for each task type.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

// ============================================
// MODEL CONFIGURATION
// ============================================

export const MODELS = {
  // Anthropic models
  anthropic: {
    opus: 'claude-opus-4-5-20251101',      // Best for complex reasoning, agents
    sonnet: 'claude-sonnet-4-20250514',    // Fast, good for most tasks
    haiku: 'claude-3-5-haiku-20241022',    // Fastest, cheapest
  },
  // Google models
  google: {
    flash: 'gemini-2.0-flash',             // Fast multimodal, good for vision
    pro: 'gemini-2.5-pro-preview-06-05',   // Best reasoning
    imageGen: 'gemini-3-pro-image-preview', // Image generation (Nano Banana)
  },
} as const;

// Default model for each provider
export const DEFAULT_MODELS = {
  anthropic: MODELS.anthropic.opus,
  google: MODELS.google.flash,
} as const;

// ============================================
// TASK TYPES & ROUTING
// ============================================

export type TaskType = 
  | 'repo_analysis'      // Analyze GitHub repo structure/potential
  | 'deep_dive'          // Deep analysis of a specific topic
  | 'code_generation'    // Generate code, prompts, artifacts
  | 'copy_generation'    // Marketing copy, tweets, posts
  | 'chart_analysis'     // Analyze chart images for TA
  | 'image_generation'   // Generate images
  | 'quick_response'     // Fast, simple responses
  | 'push_feedback';     // Analyze git push for feedback

interface TaskConfig {
  provider: 'anthropic' | 'google';
  model: string;
  reason: string;
}

/**
 * Routes task types to the optimal AI provider and model.
 * 
 * Routing logic:
 * - Vision tasks → Google (Gemini has better multimodal)
 * - Image generation → Google (Nano Banana)
 * - Complex reasoning → Anthropic Opus
 * - Fast responses → Anthropic Haiku or Google Flash
 */
export const TASK_ROUTING: Record<TaskType, TaskConfig> = {
  repo_analysis: {
    provider: 'anthropic',
    model: MODELS.anthropic.opus,
    reason: 'Complex code understanding requires Opus reasoning',
  },
  deep_dive: {
    provider: 'anthropic',
    model: MODELS.anthropic.opus,
    reason: 'Deep analysis benefits from Opus extended thinking',
  },
  code_generation: {
    provider: 'anthropic',
    model: MODELS.anthropic.opus,
    reason: 'Code generation is Opus specialty',
  },
  copy_generation: {
    provider: 'anthropic',
    model: MODELS.anthropic.sonnet,
    reason: 'Sonnet is fast and good for creative writing',
  },
  chart_analysis: {
    provider: 'google',
    model: MODELS.google.flash,
    reason: 'Gemini Flash has superior vision capabilities',
  },
  image_generation: {
    provider: 'google',
    model: MODELS.google.imageGen,
    reason: 'Gemini 3 Pro Image is the only option for generation',
  },
  quick_response: {
    provider: 'anthropic',
    model: MODELS.anthropic.haiku,
    reason: 'Haiku is fastest for simple tasks',
  },
  push_feedback: {
    provider: 'anthropic',
    model: MODELS.anthropic.sonnet,
    reason: 'Sonnet balances speed and quality for feedback',
  },
};

// ============================================
// ENVIRONMENT VARIABLES
// ============================================

export const ENV_KEYS = {
  // AI Providers
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  GOOGLE_AI_KEY: 'GOOGLE_AI_KEY',        // Primary
  GEMINI_API_KEY: 'GEMINI_API_KEY',      // Fallback alias
  
  // Telegram
  TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
  USER_TELEGRAM_CHAT_ID: 'USER_TELEGRAM_CHAT_ID',
  
  // GitHub
  GITHUB_TOKEN: 'GITHUB_TOKEN',
  GITHUB_WEBHOOK_SECRET: 'GITHUB_WEBHOOK_SECRET',
  
  // Vercel
  VERCEL_TOKEN: 'VERCEL_TOKEN',
  KV_REST_API_URL: 'KV_REST_API_URL',
  KV_REST_API_TOKEN: 'KV_REST_API_TOKEN',
} as const;

// ============================================
// CLIENT SINGLETONS
// ============================================

let anthropicClient: Anthropic | null = null;
let googleClient: GoogleGenAI | null = null;

/**
 * Get or create the Anthropic client singleton
 */
export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Get or create the Google AI client singleton
 */
export function getGoogleClient(): GoogleGenAI {
  if (!googleClient) {
    const apiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_AI_KEY or GEMINI_API_KEY not configured');
    }
    googleClient = new GoogleGenAI({ apiKey });
  }
  return googleClient;
}

/**
 * Check if a specific AI provider is configured
 */
export function isProviderConfigured(provider: 'anthropic' | 'google'): boolean {
  if (provider === 'anthropic') {
    return !!process.env.ANTHROPIC_API_KEY;
  }
  return !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY);
}

/**
 * Get the configuration for a specific task type
 */
export function getTaskConfig(taskType: TaskType): TaskConfig {
  return TASK_ROUTING[taskType];
}

/**
 * Get the appropriate client for a task type
 */
export function getClientForTask(taskType: TaskType): { 
  client: Anthropic | GoogleGenAI; 
  model: string;
  provider: 'anthropic' | 'google';
} {
  const config = TASK_ROUTING[taskType];
  
  if (config.provider === 'anthropic') {
    return {
      client: getAnthropicClient(),
      model: config.model,
      provider: 'anthropic',
    };
  }
  
  return {
    client: getGoogleClient(),
    model: config.model,
    provider: 'google',
  };
}

// ============================================
// HEALTH CHECK
// ============================================

export interface AIHealthStatus {
  anthropic: { configured: boolean; model: string };
  google: { configured: boolean; model: string };
}

export function getAIHealthStatus(): AIHealthStatus {
  return {
    anthropic: {
      configured: isProviderConfigured('anthropic'),
      model: DEFAULT_MODELS.anthropic,
    },
    google: {
      configured: isProviderConfigured('google'),
      model: DEFAULT_MODELS.google,
    },
  };
}

// ============================================
// LEGACY EXPORT (backwards compatibility)
// ============================================

export const AI_MODEL = MODELS.anthropic.opus;
