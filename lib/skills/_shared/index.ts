/**
 * Shared Skill Infrastructure
 *
 * Re-exports all shared types, utilities, and factories.
 */

// Types
export type {
  Skill,
  SkillDependency,
  SkillContext,
  SkillResult,
  TelegramAdapter,
  SessionManager,
  SessionType,
  StoredSession,
  GoogleClient,
  MessageOptions,
  PhotoOptions,
  MessageResult,
  ProgressOptions,
  ProgressTracker,
} from './types.js';

// Context
export {
  createSkillContext,
  createTestContext,
  validateDependencies,
  getMockTelegram,
  getMockSessions,
} from './context.js';

// Telegram Adapter
export {
  GrammyTelegramAdapter,
  MockTelegramAdapter,
} from './telegram-adapter.js';

// Sessions
export {
  KVSessionManager,
  MockSessionManager,
  SessionNotFoundError,
  SESSION_TTLS,
  acquireSkillLock,
  releaseSkillLock,
} from './sessions.js';

// Progress
export {
  ProgressTracker as ProgressTrackerImpl,
  SilentProgressTracker,
  CLIProgressTracker,
  createProgressTracker,
} from './progress.js';
export type { ProgressMode } from './progress.js';
