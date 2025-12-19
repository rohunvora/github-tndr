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

import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { LinkHandler, ParsedLink, LinkActionContext } from '../types.js';
import { formatLinkCallback } from '../types.js';
import { stateManager } from '../../core/state.js';
import { info } from '../../core/logger.js';

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
  
  getKeyboard: async (link: ParsedLink<GitHubLinkData>, ctx: Context): Promise<InlineKeyboard> => {
    const { owner, name } = link.data;
    const kb = new InlineKeyboard();
    
    // Check if we already track this repo
    const tracked = await stateManager.getTrackedRepo(owner, name);
    
    // Primary actions row
    kb.text('🔍 Analyze', formatLinkCallback('github', 'analyze', owner, name));
    kb.text('🎨 Preview', formatLinkCallback('github', 'preview', owner, name));
    kb.row();
    
    // Secondary actions
    kb.text('📝 README', formatLinkCallback('github', 'readme', owner, name));
    kb.text('👁️ Watch', formatLinkCallback('github', 'watch', owner, name));
    
    // Show status hint if tracked
    if (tracked) {
      const stateEmoji = tracked.state === 'shipped' ? '🚀' 
        : tracked.state === 'ready' ? '✅' 
        : tracked.state === 'dead' ? '☠️' 
        : '📊';
      kb.row();
      kb.text(`${stateEmoji} View Status`, formatLinkCallback('github', 'status', owner, name));
    }
    
    return kb;
  },
  
  formatMessage: async (link: ParsedLink<GitHubLinkData>, ctx: Context): Promise<string> => {
    const { owner, name } = link.data;
    
    // Check if we already track this repo
    const tracked = await stateManager.getTrackedRepo(owner, name);
    
    let statusLine = '';
    if (tracked) {
      const stateLabel = tracked.state === 'shipped' ? 'Shipped 🚀' 
        : tracked.state === 'ready' ? 'Ready to ship'
        : tracked.state === 'has_core' ? 'Needs focus'
        : tracked.state === 'dead' ? 'Dead'
        : 'Analyzed';
      statusLine = `\n_${stateLabel}_`;
    }
    
    return `**${owner}/${name}**${statusLine}\n\nWhat would you like to do?`;
  },
  
  handleAction: async ({ ctx, action, parts }: LinkActionContext<GitHubLinkData>): Promise<void> => {
    // parts = [owner, name] from callback data
    const [owner, name] = parts;
    const repoInput = `${owner}/${name}`;
    
    await ctx.answerCallbackQuery();
    
    // Delete the menu message before running action
    try { 
      await ctx.deleteMessage(); 
    } catch { 
      // Message may already be deleted
    }
    
    // Dynamically import handlers to avoid circular deps
    switch (action) {
      case 'analyze': {
        const { handleRepo } = await import('../../bot/handlers/repo.js');
        await handleRepo(ctx, repoInput);
        break;
      }
      
      case 'preview': {
        const { registry } = await import('../../tools/registry.js');
        await registry.handleCommand('preview', ctx, repoInput);
        break;
      }
      
      case 'readme': {
        const { registry } = await import('../../tools/registry.js');
        await registry.handleCommand('readme', ctx, repoInput);
        break;
      }
      
      case 'watch': {
        const { handleWatch } = await import('../../bot/handlers/watch.js');
        await handleWatch(ctx, repoInput);
        break;
      }
      
      case 'status': {
        // Show the repo card if tracked
        const tracked = await stateManager.getTrackedRepo(owner, name);
        if (tracked) {
          const { formatCard } = await import('../../bot/format.js');
          const { InlineKeyboard } = await import('grammy');
          
          // Simple keyboard for status view
          const kb = new InlineKeyboard()
            .text('📋 More', `more:${owner}:${name}`)
            .text('🔄 Re-analyze', `reanalyze:${owner}:${name}`);
          
          const msg = await ctx.reply(formatCard(tracked), { 
            parse_mode: 'Markdown', 
            reply_markup: kb,
          });
          await stateManager.setMessageRepo(msg.message_id, owner, name);
        } else {
          await ctx.reply(`Repo not tracked. Use Analyze first.`);
        }
        break;
      }
      
      default:
        info('github-link', `Unknown action: ${action}`);
        await ctx.reply(`Unknown action: ${action}`);
    }
  },
};

