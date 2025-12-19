/**
 * Preview Tool
 * 
 * Generate cover images for GitHub repos with iterative feedback.
 * 
 * Commands:
 * - /preview <repo> - Generate a cover image
 * 
 * Flow:
 * 1. Auto-analyzes repo if needed
 * 2. Generates cover image with Gemini
 * 3. Shows preview with Approve/Reject/Cancel
 * 4. On reject: collects feedback, regenerates
 * 5. On approve: uploads to GitHub + updates README
 * 
 * @example
 * ```
 * /preview my-app
 * → [Progress breadcrumbs]
 * → [Image preview with buttons]
 * → User clicks Reject
 * → "What should change?"
 * → User replies: "make it darker"
 * → [Regenerated image]
 * → User clicks Approve
 * → ✅ Uploaded to GitHub
 * ```
 */

import type { Tool } from '../types.js';
import {
  handlePreviewCommand,
  handlePreviewApprove,
  handlePreviewReject,
  handlePreviewCancel,
} from './handler.js';

export const previewTool: Tool = {
  name: 'preview',
  version: '2.0.0', // Updated for new feedback flow
  description: 'Generate cover images for repos with iterative feedback',

  commands: [
    {
      name: 'preview',
      description: 'Generate a cover image for a repo',
      handler: handlePreviewCommand,
    },
  ],

  callbackHandlers: [
    // Approve: upload to GitHub
    {
      pattern: 'preview_approve:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('preview_approve:', '');
        await handlePreviewApprove(ctx, sessionId);
      },
    },
    // Reject: prompt for feedback
    {
      pattern: 'preview_reject:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('preview_reject:', '');
        await handlePreviewReject(ctx, sessionId);
      },
    },
    // Cancel: discard session
    {
      pattern: 'preview_cancel:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('preview_cancel:', '');
        await handlePreviewCancel(ctx, sessionId);
      },
    },
    // Legacy handlers for backwards compatibility
    {
      pattern: 'preview_use:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('preview_use:', '');
        await handlePreviewApprove(ctx, sessionId);
      },
    },
    {
      pattern: 'preview_regen:',
      handler: async (ctx, data) => {
        const sessionId = data.replace('preview_regen:', '');
        await handlePreviewReject(ctx, sessionId);
      },
    },
  ],
};

// Re-export for direct imports
export { generateCoverImage } from './generator.js';
export { handleFeedbackReply } from './feedback.js';
export type { PreviewSession } from './sessions.js';
