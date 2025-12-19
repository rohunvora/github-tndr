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
    
    // Primary actions row - TLDR is the main action
    kb.text('📸 TLDR', formatLinkCallback('github', 'tldr', owner, name));
    kb.text('🎨 Preview', formatLinkCallback('github', 'preview', owner, name));
    kb.row();
    
    // Secondary actions
    kb.text('📝 README', formatLinkCallback('github', 'readme', owner, name));
    
    // Show status if already tracked
    if (tracked) {
      const stateEmoji = tracked.state === 'shipped' ? '🚀' 
        : tracked.state === 'ready' ? '✅' 
        : tracked.state === 'dead' ? '☠️' 
        : '📊';
      kb.text(`${stateEmoji} Status`, formatLinkCallback('github', 'status', owner, name));
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
      case 'tldr': {
        // TLDR: Analyze + Generate image + Show brief summary
        await handleTldr(ctx, owner, name);
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
          await ctx.reply(`Repo not tracked. Use TLDR first.`);
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
 * TLDR Handler - Analyze repo + Generate image + Show brief summary
 * All in one action with the cover image
 */
async function handleTldr(ctx: Context, owner: string, name: string): Promise<void> {
  info('tldr', 'Starting', { owner, name });
  
  // Show progress
  const progressMsg = await ctx.reply(`📸 **${owner}/${name}**\n\n⏳ Analyzing...`, { parse_mode: 'Markdown' });
  const chatId = ctx.chat!.id;
  
  try {
    // Import what we need
    const { GitHubClient } = await import('../../core/github.js');
    const { getRepoAnalyzer } = await import('../../tools/repo/analyzer.js');
    const { generateCoverImage } = await import('../../tools/preview/generator.js');
    
    const github = new GitHubClient(process.env.GITHUB_TOKEN!);
    
    // 1. Check if already analyzed
    let repo = await stateManager.getTrackedRepo(owner, name);
    
    if (!repo?.analysis) {
      // Need to analyze first
      await ctx.api.editMessageText(chatId, progressMsg.message_id, 
        `📸 **${owner}/${name}**\n\n⏳ Analyzing with Claude...`, 
        { parse_mode: 'Markdown' }
      );
      
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
    }
    
    // 2. Generate cover image
    await ctx.api.editMessageText(chatId, progressMsg.message_id, 
      `📸 **${owner}/${name}**\n\n✓ Analyzed\n⏳ Generating cover...`, 
      { parse_mode: 'Markdown' }
    );
    
    const imageBuffer = await generateCoverImage(repo, []);
    
    // 3. Build TLDR caption
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
    
    // Delete progress message
    try {
      await ctx.api.deleteMessage(chatId, progressMsg.message_id);
    } catch { /* ok */ }
    
    // 4. Send image with TLDR caption
    const kb = new InlineKeyboard()
      .text('📋 Details', `more:${owner}:${name}`)
      .text('🎨 New Cover', formatLinkCallback('github', 'preview', owner, name));
    
    const msg = await ctx.replyWithPhoto(new InputFile(imageBuffer, `${name}-cover.png`), {
      caption,
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
    
    await stateManager.setMessageRepo(msg.message_id, owner, name);
    
    info('tldr', 'Complete', { owner, name });
    
  } catch (err) {
    logErr('tldr', err, { owner, name });
    try {
      await ctx.api.editMessageText(chatId, progressMsg.message_id, 
        `❌ **${owner}/${name}**\n\n${err instanceof Error ? err.message : 'Unknown error'}`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
}

