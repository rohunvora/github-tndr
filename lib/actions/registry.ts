/**
 * Action Registry & Orchestrator
 * 
 * Central registry for all actions with automatic dependency resolution.
 * The orchestrator builds a dependency chain and executes actions in order,
 * skipping cached results and showing progress throughout.
 */

import type { Context } from 'grammy';
import type { TrackedRepo } from '../core/types.js';
import type { Action, ActionContext, ActionResult, PipelineOptions, PipelineProgress, ActionStatus } from './types.js';
import { info, error as logErr } from '../core/logger.js';

// ============ REGISTRY ============

const actions = new Map<string, Action>();

/**
 * Register an action with the registry
 */
export function registerAction(action: Action): void {
  if (actions.has(action.name)) {
    throw new Error(`Action "${action.name}" is already registered`);
  }
  actions.set(action.name, action);
  info('actions', `Registered action: ${action.name}`, { dependencies: action.dependencies });
}

/**
 * Get an action by name
 */
export function getAction(name: string): Action | undefined {
  return actions.get(name);
}

/**
 * Get all registered actions
 */
export function getAllActions(): Action[] {
  return Array.from(actions.values());
}

// ============ DEPENDENCY RESOLUTION ============

/**
 * Resolve the full dependency chain for an action using topological sort
 * Returns actions in execution order (dependencies first)
 * 
 * @example
 * // If preview depends on analyze:
 * resolveDependencyChain('preview') // ['analyze', 'preview']
 */
export function resolveDependencyChain(actionName: string): string[] {
  const action = actions.get(actionName);
  if (!action) {
    throw new Error(`Unknown action: ${actionName}`);
  }

  const visited = new Set<string>();
  const result: string[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);

    const act = actions.get(name);
    if (!act) {
      throw new Error(`Unknown dependency: ${name}`);
    }

    // Visit dependencies first
    for (const dep of act.dependencies) {
      visit(dep);
    }

    result.push(name);
  }

  visit(actionName);
  return result;
}

// ============ ORCHESTRATOR ============

/**
 * Execute an action with automatic dependency resolution
 * 
 * This is the main entry point for running actions.
 * It will:
 * 1. Resolve the dependency chain
 * 2. Check cache for each action
 * 3. Run uncached actions in order
 * 4. Update progress throughout
 * 
 * @example
 * ```typescript
 * // User clicks "Cover" button
 * const result = await executeAction('preview', ctx, owner, name, repo);
 * // Automatically runs: analyze (if not cached) -> preview
 * ```
 */
export async function executeAction(
  actionName: string,
  ctx: Context,
  owner: string,
  name: string,
  repo: TrackedRepo,
  options: PipelineOptions = {}
): Promise<ActionResult> {
  const chain = resolveDependencyChain(actionName);
  
  info('actions', `Executing action chain for ${actionName}`, { chain });

  // Build progress state
  const progress: PipelineProgress = {
    chatId: ctx.chat!.id,
    messageId: 0, // Will be set when we send initial message
    actions: chain.map(name => {
      const act = actions.get(name)!;
      return {
        name,
        label: act.label,
        status: 'pending' as ActionStatus,
      };
    }),
    startTime: Date.now(),
    title: options.progressPrefix || `${owner}/${name}`,
  };

  // Send initial progress message
  const progressMsg = await ctx.reply(formatProgress(progress), { parse_mode: 'Markdown' });
  progress.messageId = progressMsg.message_id;

  // Track current repo state through the chain
  let currentRepo = repo;

  try {
    for (const actName of chain) {
      const action = actions.get(actName)!;
      const actionProgress = progress.actions.find(a => a.name === actName)!;

      // Check if cached (unless force refresh)
      if (!options.forceRefresh && action.isCached(currentRepo)) {
        actionProgress.status = 'cached';
        await updateProgressMessage(ctx, progress);
        info('actions', `${actName}: using cached result`);
        continue;
      }

      // Mark as running
      actionProgress.status = 'running';
      const actionStartTime = Date.now();
      await updateProgressMessage(ctx, progress);

      // Create action context
      const actx: ActionContext = {
        ctx,
        repo: currentRepo,
        owner,
        name,
        updateProgress: async (status) => {
          actionProgress.status = status;
          actionProgress.elapsed = Math.floor((Date.now() - actionStartTime) / 1000);
          await updateProgressMessage(ctx, progress);
        },
      };

      // Run the action
      info('actions', `${actName}: starting`);
      const result = await action.run(actx);

      if (!result.success) {
        actionProgress.status = 'error';
        await updateProgressMessage(ctx, progress);
        logErr('actions', result.error || `${actName}: failed`);
        return result;
      }

      // Update repo state for next action
      currentRepo = result.repo;
      actionProgress.status = 'done';
      actionProgress.elapsed = Math.floor((Date.now() - actionStartTime) / 1000);
      await updateProgressMessage(ctx, progress);
      info('actions', `${actName}: completed in ${actionProgress.elapsed}s`);
    }

    // All actions completed
    return { success: true, repo: currentRepo };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    logErr('actions', `Pipeline failed: ${errMsg}`);
    
    // Mark current action as error
    const runningAction = progress.actions.find(a => a.status === 'running');
    if (runningAction) {
      runningAction.status = 'error';
      await updateProgressMessage(ctx, progress);
    }

    return { success: false, repo: currentRepo, error: errMsg };
  }
}

// ============ PROGRESS DISPLAY ============

/**
 * Format progress state into a display string
 */
function formatProgress(progress: PipelineProgress): string {
  const lines = [`*${progress.title}*\n`];
  
  for (const action of progress.actions) {
    const icon = getStatusIcon(action.status);
    const elapsed = action.elapsed ? ` (${action.elapsed}s)` : '';
    lines.push(`${icon} ${action.label}${elapsed}`);
  }

  return lines.join('\n');
}

/**
 * Get icon for action status
 */
function getStatusIcon(status: ActionStatus): string {
  switch (status) {
    case 'pending': return '○';
    case 'running': return '⏳';
    case 'done': return '✓';
    case 'cached': return '↺';
    case 'error': return '✗';
  }
}

/**
 * Update the progress message in Telegram
 */
async function updateProgressMessage(ctx: Context, progress: PipelineProgress): Promise<void> {
  try {
    await ctx.api.editMessageText(
      progress.chatId,
      progress.messageId,
      formatProgress(progress),
      { parse_mode: 'Markdown' }
    );
  } catch {
    // Ignore edit errors (message not modified, etc.)
  }
}

