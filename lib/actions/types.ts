/**
 * Action Pipeline Types
 * 
 * Defines the interface for chainable actions with automatic dependency resolution.
 * Actions declare their prerequisites, and the orchestrator runs them automatically.
 */

import type { Context } from 'grammy';
import type { TrackedRepo } from '../core/types.js';

/**
 * Result of an action execution
 */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Updated repo data (may have new analysis, cover URL, etc.) */
  repo: TrackedRepo;
  /** Optional output data specific to the action */
  output?: unknown;
  /** Error message if failed */
  error?: string;
}

/**
 * Context passed to action runners
 */
export interface ActionContext {
  /** Grammy context for Telegram interactions */
  ctx: Context;
  /** Current repo state */
  repo: TrackedRepo;
  /** Repository owner */
  owner: string;
  /** Repository name */
  name: string;
  /** Update progress display */
  updateProgress: (status: ActionStatus) => Promise<void>;
}

/**
 * Status of an action in the pipeline
 */
export type ActionStatus = 'pending' | 'running' | 'done' | 'cached' | 'error';

/**
 * Action definition
 * 
 * Each action declares:
 * - dependencies: Other actions that must complete first
 * - isCached: Check if this action's output already exists
 * - run: Execute the action
 * 
 * @example
 * ```typescript
 * const previewAction: Action = {
 *   name: 'preview',
 *   label: 'Generating cover',
 *   dependencies: ['analyze'],
 *   isCached: (repo) => !!repo.cover_image_url,
 *   run: async (actx) => {
 *     const image = await generateCover(actx.repo);
 *     return { success: true, repo: { ...actx.repo, cover_image_url: image } };
 *   },
 * };
 * ```
 */
export interface Action {
  /** Unique identifier for this action */
  name: string;
  
  /** Human-readable label for progress display */
  label: string;
  
  /** Names of actions that must run before this one */
  dependencies: string[];
  
  /**
   * Check if this action's output is already cached
   * If true, the orchestrator skips running this action
   */
  isCached: (repo: TrackedRepo) => boolean;
  
  /**
   * Execute the action
   * Receives the action context with repo data and progress updater
   * Must return updated repo state
   */
  run: (actx: ActionContext) => Promise<ActionResult>;
}

/**
 * Pipeline execution options
 */
export interface PipelineOptions {
  /** Skip cache checks and force re-run all actions */
  forceRefresh?: boolean;
  /** Custom progress message prefix */
  progressPrefix?: string;
}

/**
 * Progress state for a pipeline execution
 */
export interface PipelineProgress {
  /** Chat ID for message editing */
  chatId: number;
  /** Message ID of the progress message */
  messageId: number;
  /** Actions in the pipeline with their status */
  actions: Array<{
    name: string;
    label: string;
    status: ActionStatus;
    elapsed?: number;
  }>;
  /** When the pipeline started */
  startTime: number;
  /** Title/context for the progress display */
  title: string;
}

