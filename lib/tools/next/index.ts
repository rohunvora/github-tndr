/**
 * Next Tool
 * Carousel for selecting what to work on
 */

import type { Tool } from '../types.js';
import {
  handleNextCommand,
  handlePrev,
  handleNext,
  handleSelect,
} from './handler.js';

export const nextTool: Tool = {
  name: 'next',
  version: '1.0.0',
  description: 'Carousel to pick your next project',

  commands: [
    {
      name: 'next',
      description: 'Show project carousel to pick what to work on',
      handler: handleNextCommand,
    },
  ],

  callbackHandlers: [
    {
      pattern: 'next_prev:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('next_prev:', '');
        await handlePrev(ctx, sessionId);
      },
    },
    {
      pattern: 'next_next:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('next_next:', '');
        await handleNext(ctx, sessionId);
      },
    },
    {
      pattern: 'next_select:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('next_select:', '');
        await handleSelect(ctx, sessionId);
      },
    },
  ],
};

export { getProjectCandidates, type ProjectCandidate } from './selector.js';

