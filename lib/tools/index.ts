/**
 * Tools Module
 * Re-exports tool infrastructure and all tools
 */

// Infrastructure
export { registry, registerTools } from './registry.js';
export type {
  Tool,
  ToolCommand,
  CommandHandler,
  MessageHandler,
  CallbackHandler,
  ToolResult,
} from './types.js';

// Tools
export { chartTool } from './chart/index.js';
export { repoTool } from './repo/index.js';
export { scanTool } from './scan/index.js';
export { previewTool } from './preview/index.js';
export { readmeTool } from './readme/index.js';
export { nextTool } from './next/index.js';

// All tools array for easy registration
import { chartTool } from './chart/index.js';
import { repoTool } from './repo/index.js';
import { scanTool } from './scan/index.js';
import { previewTool } from './preview/index.js';
import { readmeTool } from './readme/index.js';
import { nextTool } from './next/index.js';

export const allTools = [
  chartTool,
  repoTool,
  scanTool,
  previewTool,
  readmeTool,
  nextTool,
];

