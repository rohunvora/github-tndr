/**
 * @deprecated This module is deprecated. Use lib/tools/preview/generator.ts instead.
 * 
 * The functionality has been moved to the preview tool with additional features:
 * - Feedback-based regeneration
 * - Timeout handling
 * - Screenshot fallback
 * 
 * Migration:
 * ```typescript
 * // Old:
 * import { generateRepoCover } from './nano-banana.js';
 * const image = await generateRepoCover(repo);
 * 
 * // New:
 * import { generateCoverImage } from './tools/preview/generator.js';
 * const image = await generateCoverImage(repo, []);
 * ```
 */

import { generateCoverImage, polishScreenshot } from './tools/preview/generator.js';
import type { TrackedRepo } from './core/types.js';

/**
 * @deprecated Use generateCoverImage from './tools/preview/generator.js' instead
 */
export async function generateRepoCover(repo: TrackedRepo): Promise<Buffer> {
  console.warn('DEPRECATED: generateRepoCover is deprecated. Use generateCoverImage from lib/tools/preview/generator.js');
  return generateCoverImage(repo, []);
}

// Re-export for backwards compatibility
export { polishScreenshot };
