/**
 * Action Pipeline System
 * 
 * Exports the action registry, orchestrator, and all action definitions.
 * Actions are automatically registered when this module is imported.
 */

export * from './types.js';
export * from './registry.js';
export { allActions, analyzeAction, previewAction, readmeAction, tldrAction } from './definitions.js';

// ============ AUTO-REGISTER ACTIONS ============

import { registerAction } from './registry.js';
import { allActions } from './definitions.js';

// Register all actions on module load
for (const action of allActions) {
  registerAction(action);
}

