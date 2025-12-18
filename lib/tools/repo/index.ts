/**
 * Repo Analysis Tool
 * Analyzes GitHub repositories and gives ship/cut/kill verdicts
 */

import type { Tool } from '../types.js';
import { handleRepoCommand, handleRepoDetails, handleRepoBack } from './handler.js';

export const repoTool: Tool = {
  name: 'repo',
  version: '1.0.0',
  description: 'Analyze GitHub repositories for core value',

  commands: [
    {
      name: 'repo',
      description: 'Analyze a GitHub repo (e.g., /repo myrepo or /repo owner/repo)',
      handler: handleRepoCommand,
    },
  ],

  callbackHandlers: [
    {
      pattern: 'more:',
      handler: async (ctx, data) => {
        const [, owner, name] = data.split(':');
        await handleRepoDetails(ctx, owner, name);
      },
    },
    {
      pattern: 'back:',
      handler: async (ctx, data) => {
        const [, owner, name] = data.split(':');
        await handleRepoBack(ctx, owner, name);
      },
    },
  ],
};

// Re-export
export { RepoAnalyzer, getRepoAnalyzer } from './analyzer.js';
export * from './format.js';

