/**
 * Chart Analysis Tool
 * Analyzes chart images and annotates support/resistance zones
 */

import type { Tool } from '../types.js';
import { handlePhoto } from './handler.js';

export const chartTool: Tool = {
  name: 'chart',
  version: '1.0.0',
  description: 'Analyze chart images for support/resistance zones',

  messageHandlers: [
    {
      type: 'photo',
      priority: 10, // High priority - photos are likely charts
      handler: handlePhoto,
    },
  ],
};

// Re-export types and functions for direct use
export * from './types.js';
export * from './analysis.js';
export * from './format.js';

