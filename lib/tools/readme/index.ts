/**
 * README Tool
 * Generate optimized READMEs
 */

import type { Tool } from '../types.js';
import {
  handleReadmeCommand,
  handleReadmePush,
  handleReadmeCopy,
  handleReadmeCancel,
} from './handler.js';

export const readmeTool: Tool = {
  name: 'readme',
  version: '1.0.0',
  description: 'Generate optimized READMEs',

  commands: [
    {
      name: 'readme',
      description: 'Generate/optimize README for a repo',
      handler: handleReadmeCommand,
    },
  ],

  callbackHandlers: [
    {
      pattern: 'readme_push:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('readme_push:', '');
        await handleReadmePush(ctx, sessionId);
      },
    },
    {
      pattern: 'readme_copy:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('readme_copy:', '');
        await handleReadmeCopy(ctx, sessionId);
      },
    },
    {
      pattern: 'readme_cancel:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('readme_cancel:', '');
        await handleReadmeCancel(ctx, sessionId);
      },
    },
  ],
};

export { generateReadme } from './generator.js';

