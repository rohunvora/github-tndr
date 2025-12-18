/**
 * Scan Tool
 * Batch analyze all GitHub repos
 */

import type { Tool } from '../types.js';
import { handleScanCommand, handleCancelCommand, handleStatusCommand } from './handler.js';

export const scanTool: Tool = {
  name: 'scan',
  version: '1.0.0',
  description: 'Batch analyze all your GitHub repos',

  commands: [
    {
      name: 'scan',
      description: 'Scan repos from last N days (default: 10)',
      handler: handleScanCommand,
    },
    {
      name: 'cancel',
      description: 'Cancel running scan',
      handler: handleCancelCommand,
    },
    {
      name: 'status',
      description: 'Show repo counts by state',
      handler: handleStatusCommand,
    },
  ],
};

export * from './format.js';

