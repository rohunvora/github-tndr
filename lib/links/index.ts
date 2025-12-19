/**
 * Link Handlers Module
 * 
 * Smart link detection for various URL types.
 * Register new handlers by adding them to allLinkHandlers.
 */

export * from './types.js';
export * from './registry.js';

// Import all handlers
import { githubLinkHandler } from './handlers/github.js';

// Export individual handlers and utilities
export { githubLinkHandler };
export { 
  buildGitHubRepoKeyboard, 
  buildGitHubRepoKeyboardRaw,
} from './handlers/github.js';

/**
 * All link handlers to register
 * Add new handlers here as they're created
 */
export const allLinkHandlers = [
  githubLinkHandler,
  // Future handlers:
  // twitterLinkHandler,
  // npmLinkHandler,
  // vercelLinkHandler,
];

