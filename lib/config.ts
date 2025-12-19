/**
 * AI Config - Re-exports from core
 * @deprecated Use lib/core/config.js directly
 */

export {
  MODELS,
  DEFAULT_MODELS,
  TASK_ROUTING,
  ENV_KEYS,
  AI_MODEL,
  getAnthropicClient,
  getGoogleClient,
  isProviderConfigured,
  getTaskConfig,
  getClientForTask,
  getAIHealthStatus,
  type TaskType,
  type AIHealthStatus,
} from './core/config.js';
