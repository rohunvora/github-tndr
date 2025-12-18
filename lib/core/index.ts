/**
 * Core Module
 * Re-exports all core infrastructure
 */

// Config & AI
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
  type TaskType,
} from './config.js';

// Logging
export {
  log,
  logError,
  info,
  debug,
  error,
} from './logger.js';

// GitHub
export {
  GitHubClient,
  type GitHubRepo,
  type GitHubCommit,
} from './github.js';

// State
export {
  StateManager,
  stateManager,
} from './state.js';

// Types
export {
  // Repo types
  type RepoState,
  type Verdict,
  type ProjectStage,
  type TrackedRepo,
  type CoreAnalysis,
  CoreAnalysisSchema,
  validateAnalysis,
  
  // Evidence types
  type CoreEvidence,
  type MismatchEvidence,
  type ReadmeClaim,
  type PrideLevel,
  type DemoArtifact,
  CoreEvidenceSchema,
  MismatchEvidenceSchema,
  ReadmeClaimSchema,
  
  // Feed types
  type RepoPotential,
  type LastContext,
  type NextStep,
  type NextStepSource,
  type ArtifactType,
  type RepoCard,
} from './types.js';

