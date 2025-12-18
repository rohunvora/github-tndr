/**
 * Preview Tool
 * Generate cover images and add to README
 */

import type { Tool } from '../types.js';
import {
  handlePreviewCommand,
  handlePreviewUse,
  handlePreviewRegen,
  handlePreviewCancel,
} from './handler.js';

export const previewTool: Tool = {
  name: 'preview',
  version: '1.0.0',
  description: 'Generate cover images for repos',

  commands: [
    {
      name: 'preview',
      description: 'Generate a cover image for a repo',
      handler: handlePreviewCommand,
    },
  ],

  callbackHandlers: [
    {
      pattern: 'preview_use:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('preview_use:', '');
        await handlePreviewUse(ctx, sessionId);
      },
    },
    {
      pattern: 'preview_regen:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('preview_regen:', '');
        await handlePreviewRegen(ctx, sessionId);
      },
    },
    {
      pattern: 'preview_cancel:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('preview_cancel:', '');
        await handlePreviewCancel(ctx, sessionId);
      },
    },
  ],
};

export { generateCoverImage } from './generator.js';

