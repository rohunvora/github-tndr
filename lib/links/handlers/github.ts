/**
 * GitHub Link Handler
 * 
 * Detects GitHub repository URLs and shows an action menu.
 * 
 * Supported formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/blob/main/...
 * - https://github.com/owner/repo/tree/main/...
 * - github.com/owner/repo
 * - git@github.com:owner/repo.git
 */

import { InlineKeyboard, InputFile } from 'grammy';
import type { Context } from 'grammy';
import type { LinkHandler, ParsedLink, LinkActionContext } from '../types.js';
import { formatLinkCallback } from '../types.js';
import { stateManager } from '../../core/state.js';
import { info, error as logErr } from '../../core/logger.js';
import { executeAction } from '../../actions/index.js';
import type { TrackedRepo } from '../../core/types.js';

// ============ Types ============

export interface GitHubLinkData {
  owner: string;
  name: string;
}

// ============ Parsing ============

// Regex patterns
const GITHUB_URL_REGEX = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\s?#]+)/i;
const GITHUB_SSH_REGEX = /^git@github\.com:([^\/]+)\/([^\/\s]+?)(?:\.git)?$/i;

function parseGitHubUrl(input: string): GitHubLinkData | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  
  // Try HTTPS URL
  const httpsMatch = trimmed.match(GITHUB_URL_REGEX);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      name: httpsMatch[2].replace(/\.git$/, ''),
    };
  }
  
  // Try SSH format
  const sshMatch = trimmed.match(GITHUB_SSH_REGEX);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      name: sshMatch[2].replace(/\.git$/, ''),
    };
  }
  
  return null;
}

// ============ Verdict Display ============

const verdictEmoji: Record<string, string> = {
  ship: '🟢',
  cut_to_core: '🟡',
  no_core: '🔴',
  dead: '☠️',
};

const verdictLabel: Record<string, string> = {
  ship: 'SHIP',
  cut_to_core: 'CUT TO CORE',
  no_core: 'NO CORE',
  dead: 'DEAD',
};

// ============ Shared Keyboard Builder ============

/**
 * Build the GitHub repo action keyboard
 * Reusable across: link detection, push notifications, etc.
 * 
 * 3 clear actions:
 * - TLDR: Fast summary (analyze if needed, use cached cover)
 * - Cover: Generate new cover image (slow, ~30s)
 * - README: Generate/optimize README
 */
export function buildGitHubRepoKeyboard(owner: string, name: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📸 TLDR', formatLinkCallback('github', 'tldr', owner, name))
    .text('🎨 Cover', formatLinkCallback('github', 'preview', owner, name))
    .row()
    .text('📝 README', formatLinkCallback('github', 'readme', owner, name));
}

/**
 * Build keyboard as plain object (for use in raw Telegram API calls)
 * Used by webhook handler which doesn't have Grammy context
 */
export function buildGitHubRepoKeyboardRaw(
  owner: string,
  name: string
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [
        { text: '📸 TLDR', callback_data: formatLinkCallback('github', 'tldr', owner, name) },
        { text: '🎨 Cover', callback_data: formatLinkCallback('github', 'preview', owner, name) },
      ],
      [
        { text: '📝 README', callback_data: formatLinkCallback('github', 'readme', owner, name) },
      ],
    ],
  };
}

// ============ Handler Implementation ============

export const githubLinkHandler: LinkHandler<GitHubLinkData> = {
  type: 'github',
  name: 'GitHub Repository',
  description: 'Detect GitHub repo URLs and show action menu',
  priority: 100, // High priority - GitHub links are common
  
  match: (text: string): boolean => {
    const lower = text.toLowerCase().trim();
    return lower.includes('github.com') || lower.startsWith('git@github.com');
  },
  
  parse: (text: string): ParsedLink<GitHubLinkData> | null => {
    const data = parseGitHubUrl(text);
    if (!data) return null;
    
    return {
      type: 'github',
      raw: text,
      data,
      label: `${data.owner}/${data.name}`,
    };
  },
  
  getKeyboard: async (link: ParsedLink<GitHubLinkData>): Promise<InlineKeyboard> => {
    const { owner, name } = link.data;
    return buildGitHubRepoKeyboard(owner, name);
  },
  
  formatMessage: async (link: ParsedLink<GitHubLinkData>): Promise<string> => {
    const { owner, name } = link.data;
    return `**${owner}/${name}**`;
  },
  
  handleAction: async ({ ctx, action, parts }: LinkActionContext<GitHubLinkData>): Promise<void> => {
    // parts = [owner, name] from callback data
    const [owner, name] = parts;
    
    await ctx.answerCallbackQuery();
    
    // Delete the menu message before running action
    try { 
      await ctx.deleteMessage(); 
    } catch { 
      // Message may already be deleted
    }
    
    // Get or create repo record
    let repo = await stateManager.getTrackedRepo(owner, name);
    if (!repo) {
      repo = createEmptyRepo(owner, name);
    }
    
    // Use the action pipeline - it handles dependencies automatically
    switch (action) {
      case 'tldr': {
        // TLDR: Custom handler for fast summary (uses cached data)
        await handleTldr(ctx, owner, name);
        break;
      }
      
      case 'preview': {
        // Preview: Uses pipeline - will auto-run analyze if needed
        const result = await executeAction('preview', ctx, owner, name, repo);
        if (!result.success) {
          await ctx.reply(`❌ Failed to generate cover: ${result.error}`, { parse_mode: 'Markdown' });
        }
        break;
      }
      
      case 'readme': {
        // README: Uses pipeline - will auto-run analyze if needed
        const result = await executeAction('readme', ctx, owner, name, repo);
        if (!result.success) {
          await ctx.reply(`❌ Failed to generate README: ${result.error}`, { parse_mode: 'Markdown' });
        }
        break;
      }
      
      default:
        info('github-link', `Unknown action: ${action}`);
        await ctx.reply(`Unknown action: ${action}`);
    }
  },
};

/**
 * TLDR Handler - Fast summary with cached image
 * 
 * Flow:
 * 1. Use cached analysis if available, else analyze (15-30s)
 * 2. Use cached cover image if available (instant)
 * 3. If no cover, show text-only with "Generate Cover" button
 * 
 * This keeps TLDR fast and within Vercel's 60s timeout.
 * Image generation is deferred to explicit Preview action.
 */
async function handleTldr(ctx: Context, owner: string, name: string): Promise<void> {
  info('tldr', 'Starting', { owner, name });
  
  const chatId = ctx.chat!.id;
  let progressMsg: { message_id: number } | null = null;
  
  try {
    // 1. Check if already analyzed
    let repo = await stateManager.getTrackedRepo(owner, name);
    
    if (!repo?.analysis) {
      // Need to analyze - show progress
      progressMsg = await ctx.reply(
        `⏳ **${owner}/${name}**\n\nAnalyzing...`, 
        { parse_mode: 'Markdown' }
      );
      
      const { GitHubClient } = await import('../../core/github.js');
      const { getRepoAnalyzer } = await import('../../tools/repo/analyzer.js');
      
      const github = new GitHubClient(process.env.GITHUB_TOKEN!);
      const repoInfo = await github.getRepoInfo(owner, name);
      if (!repoInfo) {
        throw new Error(`Repo not found or private`);
      }
      
      const analysis = await getRepoAnalyzer().analyzeRepo(owner, name);
      
      // Save the analysis
      repo = {
        id: `${owner}/${name}`,
        name,
        owner,
        state: analysis.verdict === 'ship' ? 'ready' 
          : analysis.verdict === 'cut_to_core' ? 'has_core'
          : analysis.verdict === 'no_core' ? 'no_core'
          : 'dead',
        analysis,
        analyzed_at: new Date().toISOString(),
        pending_action: null,
        pending_since: null,
        last_message_id: null,
        last_push_at: repoInfo.pushed_at,
        killed_at: null,
        shipped_at: null,
        cover_image_url: null,
        homepage: repoInfo.homepage,
      };
      await stateManager.saveTrackedRepo(repo);
      
      info('tldr', 'Analysis complete', { owner, name, verdict: analysis.verdict });
      
      // Delete progress message
      try {
        await ctx.api.deleteMessage(chatId, progressMsg.message_id);
        progressMsg = null;
      } catch { /* ok */ }
    }
    
    // 2. Build TLDR caption
    const a = repo.analysis!;
    const emoji = verdictEmoji[a.verdict] || '⚪';
    const label = verdictLabel[a.verdict] || a.verdict.toUpperCase();
    
    let caption = `${emoji} **${label}** — ${name}\n\n`;
    caption += `${a.one_liner}\n`;
    
    if (a.core_value) {
      caption += `\n💎 _${a.core_value}_`;
    }
    
    // Next action hint
    if (a.verdict === 'cut_to_core' && a.cut.length > 0) {
      caption += `\n\n✂️ Cut: ${a.cut.slice(0, 3).join(', ')}`;
    } else if (a.verdict === 'ship') {
      caption += `\n\n🚀 Ready to ship!`;
    }
    
    // 3. Check for cached cover image
    const hasCover = repo.cover_image_url && repo.cover_image_url.length > 0;
    
    if (hasCover) {
      // Have cached cover - show image with caption
      const kb = new InlineKeyboard()
        .text('📋 Details', `more:${owner}:${name}`)
        .text('🎨 New Cover', formatLinkCallback('github', 'preview', owner, name));
      
      const msg = await ctx.reply(caption, {
        parse_mode: 'Markdown',
        reply_markup: kb,
        link_preview_options: {
          url: repo.cover_image_url!,
          show_above_text: true,
          prefer_large_media: true,
        },
      });
      
      await stateManager.setMessageRepo(msg.message_id, owner, name);
    } else {
      // No cover - show text with generate button
      const kb = new InlineKeyboard()
        .text('🎨 Generate Cover', formatLinkCallback('github', 'preview', owner, name))
        .row()
        .text('📋 Details', `more:${owner}:${name}`);
      
      const msg = await ctx.reply(caption, {
        parse_mode: 'Markdown',
        reply_markup: kb,
      });
      
      await stateManager.setMessageRepo(msg.message_id, owner, name);
    }
    
    info('tldr', 'Complete', { owner, name, hasCover });
    
  } catch (err) {
    logErr('tldr', err, { owner, name });
    
    const errorMsg = `❌ **${owner}/${name}**\n\n${err instanceof Error ? err.message : 'Unknown error'}`;
    
    if (progressMsg) {
      try {
        await ctx.api.editMessageText(chatId, progressMsg.message_id, errorMsg, { parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(errorMsg, { parse_mode: 'Markdown' });
      }
    } else {
      await ctx.reply(errorMsg, { parse_mode: 'Markdown' });
    }
  }
}

// ============ Helper ============

/**
 * Create an empty TrackedRepo record
 * Used when no record exists yet
 */
function createEmptyRepo(owner: string, name: string): TrackedRepo {
  return {
    id: `${owner}/${name}`,
    name,
    owner,
    state: 'unanalyzed',
    analysis: null,
    analyzed_at: null,
    pending_action: null,
    pending_since: null,
    last_message_id: null,
    last_push_at: null,
    killed_at: null,
    shipped_at: null,
    cover_image_url: null,
    homepage: null,
  };
}

