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
import type { LinkHandler } from './types.js';

// Export individual handlers and utilities
export { githubLinkHandler };
export {
  buildGitHubRepoKeyboard,
  buildGitHubRepoKeyboardRaw,
} from './handlers/github.js';

/**
 * All link handlers to register
 * Add new handlers here as they're created
 *
 * Note: Using LinkHandler<any>[] to allow handlers with different data types
 * to be stored together. Each handler maintains its own type safety internally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allLinkHandlers: LinkHandler<any>[] = [
  githubLinkHandler,
  // Future handlers:
  // twitterLinkHandler,
  // npmLinkHandler,
  // vercelLinkHandler,
];

