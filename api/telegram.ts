export const config = {
  runtime: 'edge',
  maxDuration: 60,
};

import { Bot, InlineKeyboard, Context, InputFile } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { RepoAnalyzer } from '../lib/analyzer.js';
import { stateManager } from '../lib/state.js';
import { GitHubClient } from '../lib/github.js';
import { TrackedRepo } from '../lib/core-types.js';
import {
  formatProgress, formatScanSummary, formatCategoryView, formatStatus, formatAnalysis, formatCursorPrompt,
  formatRepoCard, formatNoMoreCards, formatDeepDive, formatCompletion,
  formatShipConfirm, formatShipped, formatRepoCardWithArtifact,
  GroupedRepos, CategoryKey,
} from '../lib/bot/format.js';
import {
  analysisKeyboard, toneKeyboard, nextActionsKeyboard, startKeyboard, retryKeyboard,
  summaryKeyboard, categoryKeyboard,
  cardKeyboard, afterDoItKeyboard, completionKeyboard, deepDiveKeyboard, noMoreCardsKeyboard,
  intentionConfirmKeyboard, shipConfirmKeyboard, legacyCardKeyboard, legacyDeepDiveKeyboard,
} from '../lib/bot/keyboards.js';
import { createCardSession, getCardSession, updateCardSession } from '../lib/card-session.js';
import { verdictToState, reanalyzeRepo } from '../lib/bot/actions.js';
import { generateRepoCover } from '../lib/nano-banana.js';
import { 
  generateCard, getNextCard, markCardShown, markCardSkipped, 
  getFeedMemory, saveIntention, clearIntention,
} from '../lib/card-generator.js';
import { 
  generateCursorPromptArtifact, formatCursorPromptMessage,
  generateCopy, formatCopyMessage,
  generateLaunchPost, formatLaunchPostMessage,
  generateDeepDive, formatDeepDiveMessage,
} from '../lib/ai/index.js';
import Anthropic from '@anthropic-ai/sdk';
import { RepoCard } from '../lib/core-types.js';

// ============ BOT SETUP ============

function getBotInfo(token: string): UserFromGetMe {
  const botId = parseInt(token.split(':')[0], 10);
  return {
    id: botId, is_bot: true, first_name: 'ShipBot', username: 'ship_or_kill_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
  };
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!, {
  botInfo: getBotInfo(process.env.TELEGRAM_BOT_TOKEN!),
});

const chatId = process.env.USER_TELEGRAM_CHAT_ID!.trim();

let analyzer: RepoAnalyzer | null = null;
let github: GitHubClient | null = null;
let anthropic: Anthropic | null = null;

function getAnalyzer(): RepoAnalyzer {
  if (!analyzer) analyzer = new RepoAnalyzer(process.env.ANTHROPIC_API_KEY!, process.env.GITHUB_TOKEN!);
  return analyzer;
}

function getGitHub(): GitHubClient {
  if (!github) github = new GitHubClient(process.env.GITHUB_TOKEN!);
  return github;
}

function getAnthropic(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return anthropic;
}

async function showTyping(ctx: Context): Promise<void> {
  if (ctx.chat) await ctx.api.sendChatAction(ctx.chat.id, 'typing');
}

// ============ COMMANDS ============

bot.command('start', async (ctx) => {
  const counts = await stateManager.getRepoCounts();
  const parts = [];
  if (counts.ready > 0) parts.push(`${counts.ready} ready to ship`);
  if (counts.has_core > 0) parts.push(`${counts.has_core} need focus`);
  if (counts.shipped > 0) parts.push(`${counts.shipped} shipped`);
  const statusLine = parts.length > 0 ? `\n\n📊 ${parts.join(', ')}.` : '';

  await ctx.reply(
    `**Ship or Kill**\n\nI analyze your repos and help you decide: ship it, cut to core, or kill it.${statusLine}\n\nUse /help for all commands.`,
    { parse_mode: 'Markdown', reply_markup: startKeyboard() }
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(`**Commands**
/next — Get your next task card
/scan [days] — Analyze repos (default: 10 days)
/status — See repo counts by state
/repo <name> — Deep dive on one repo
/cancel — Cancel running scan

**Feed Actions**
⚡ Do It — Get a Cursor prompt for the task
⏭️ Skip — Move to next card
🔍 Go Deeper — See more context

**Quick Actions**
Type a repo name to see its full analysis.
Reply with "done", "ship", or "kill".

**States**
🟢 Ready to ship | 🟡 Needs focus | 🔴 No core
☠️ Dead | 🚀 Shipped | ⏳ Analyzing`, { parse_mode: 'Markdown' });
});

// ============ FEED COMMANDS ============

bot.command('next', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  
  await showTyping(ctx);
  
  try {
    // Get all tracked repos
    const repos = await stateManager.getAllTrackedRepos();
    if (repos.length === 0) {
      await ctx.reply('No repos tracked yet. Run /scan to get started.', {
        reply_markup: startKeyboard(),
      });
      return;
    }
    
    // Get the next card
    const card = await getNextCard(getAnthropic(), getGitHub(), repos);
    
    if (!card) {
      await ctx.reply(formatNoMoreCards(), {
        parse_mode: 'Markdown',
        reply_markup: noMoreCardsKeyboard(),
      });
      return;
    }
    
    // Create session for this card
    const session = await createCardSession(card);
    
    // Mark as shown
    await markCardShown(card.full_name);
    
    // Send as TEXT message with link preview for image
    // Text messages allow 4096 chars and reliable editing
    await ctx.reply(formatRepoCard(card), {
      parse_mode: 'Markdown',
      reply_markup: cardKeyboard(session.id, session.version),
      link_preview_options: card.cover_image_url ? {
        url: card.cover_image_url,
        show_above_text: true,
        prefer_large_media: true,
      } : undefined,
    });
  } catch (error) {
    console.error('Error in /next:', error);
    await ctx.reply(`❌ Failed to get next card: ${error instanceof Error ? error.message : 'Unknown error'}`, {
      reply_markup: retryKeyboard(),
    });
  }
});

bot.command('scan', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  
  // Check if scan already running to prevent webhook retry duplicates
  const activeScan = await stateManager.getActiveScan();
  if (activeScan) {
    await ctx.reply('⏳ Scan already in progress. Use /cancel to stop it.');
    return;
  }
  
  const daysMatch = (ctx.message?.text || '').match(/\/scan\s+(\d+)/);
  await runScan(ctx, daysMatch ? parseInt(daysMatch[1], 10) : 10);
});

bot.command('cancel', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  await stateManager.cancelActiveScan();
  await ctx.reply('✅ Scan cancelled.');
});

bot.command('status', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  const counts = await stateManager.getRepoCounts();
  await ctx.reply(formatStatus(counts), {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan').text('📋 List All', 'listall'),
  });
});

bot.command('repo', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  const repoInput = (ctx.message?.text || '').replace('/repo', '').trim();
  if (!repoInput) { await ctx.reply('Usage: /repo <name> or /repo <owner/name>'); return; }

  // Check if already analyzing this repo (prevent webhook retry duplicates)
  const analysisKey = `analyzing:${repoInput.toLowerCase()}`;
  const existingAnalysis = await stateManager.get(analysisKey);
  if (existingAnalysis) {
    // Check if stale (> 90 seconds old) and clear it
    const lockTime = parseInt(existingAnalysis);
    if (Date.now() - lockTime > 90000) {
      await stateManager.delete(analysisKey);
    } else {
      return; // Still processing
    }
  }
  await stateManager.set(analysisKey, Date.now().toString(), 120);

  const startTime = Date.now();
  const elapsed = () => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  
  // Single progress message - Cursor-style with elapsed time
  const progressMsg = await ctx.reply(`🔍 **Analyzing ${repoInput}**\n\n⏱ 0.0s\n\n\`resolving repo...\``, { parse_mode: 'Markdown' });
  
  const updateProgress = async (step: string, detail?: string) => {
    try {
      let msg = `🔍 **Analyzing ${repoInput}**\n\n⏱ ${elapsed()}\n\n\`${step}\``;
      if (detail) msg += `\n_${detail}_`;
      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, msg, { parse_mode: 'Markdown' });
    } catch { /* ignore edit errors */ }
  };

  try {
    let owner: string;
    let name: string;
    
    if (repoInput.includes('/')) {
      [owner, name] = repoInput.split('/');
    } else {
      await updateProgress('searching your repos...');
      const allRepos = await getGitHub().getUserRepos();
      const repo = allRepos.find(r => r.name.toLowerCase() === repoInput.toLowerCase());
      if (!repo) { 
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id,
          `❌ Repo "${repoInput}" not found in your repos.\n\nFor external repos, use: /repo owner/name`);
        await stateManager.delete(analysisKey);
        return; 
      }
      [owner, name] = repo.full_name.split('/');
    }
    
    await updateProgress('fetching repo metadata...', `github.com/${owner}/${name}`);
    const repoInfo = await getGitHub().getRepoInfo(owner, name);
    if (!repoInfo) {
      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id,
        `❌ Repo "${owner}/${name}" not found or not accessible.`);
      await stateManager.delete(analysisKey);
      return;
    }
    
    await updateProgress('reading README.md...');
    await updateProgress('fetching file tree...');
    await updateProgress('checking commit history...');
    await updateProgress('asking Claude to analyze...', 'examining code evidence');
    
    const analysis = await getAnalyzer().analyzeRepo(owner, name);

    await updateProgress('validating evidence anchors...');
    await updateProgress('saving to database...');
    
    const tracked: TrackedRepo = {
      id: `${owner}/${name}`, name, owner,
      state: verdictToState(analysis.verdict),
      analysis, analyzed_at: new Date().toISOString(),
      pending_action: null, pending_since: null, last_message_id: null,
      last_push_at: repoInfo.pushed_at || null, killed_at: null, shipped_at: null,
      cover_image_url: null,
    };
    await stateManager.saveTrackedRepo(tracked);

    // Replace progress with final result
    await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);
    const msg = await ctx.reply(formatAnalysis(tracked), {
      parse_mode: 'Markdown', reply_markup: analysisKeyboard(tracked),
    });
    await stateManager.setMessageRepo(msg.message_id, owner, name);
    await stateManager.updateRepoMessageId(owner, name, msg.message_id);
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id,
      `❌ **Analysis failed** (${elapsed()})\n\n\`${errMsg.substring(0, 200)}\``, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('🔄 Retry', `retryname:${repoInput}`),
    });
  } finally {
    await stateManager.delete(analysisKey);
  }
});

// ============ SCAN LOGIC ============

async function runScan(ctx: Context, days: number): Promise<void> {
  const startTime = Date.now();
  const TIMEOUT_MS = 55000;
  
  // Double-check no scan is running (race condition guard)
  const existingScan = await stateManager.getActiveScan();
  if (existingScan) {
    // Another scan started between command check and here - silently exit
    return;
  }
  
  const scanId = `scan_${Date.now()}`;
  await stateManager.setActiveScan(scanId);

  try {
    const fetchingMsg = await ctx.reply('🔍 Fetching repos...');
    const repos = await getGitHub().getRecentRepos(days);
    if (repos.length === 0) {
      await stateManager.cancelActiveScan();
      await ctx.api.editMessageText(ctx.chat!.id, fetchingMsg.message_id, `No repos found with activity in the last ${days} days.`);
      return;
    }

    const progressMsg = fetchingMsg;
    await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, formatProgress(0, repos.length, 0, 0));
    const analyzed: TrackedRepo[] = [];
    const errors: string[] = [];
    let cached = 0;
    let timedOut = false;
    let lastProgressUpdate = 0;

    const updateProgress = async () => {
      const now = Date.now();
      if (now - lastProgressUpdate < 500) return; // Rate limit: max 2 updates/sec
      lastProgressUpdate = now;
      try {
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id,
          formatProgress(analyzed.length + errors.length, repos.length, cached, errors.length));
      } catch { /* ignore rate limits */ }
    };

    for (let i = 0; i < repos.length; i += 5) {
      if (Date.now() - startTime > TIMEOUT_MS) { timedOut = true; break; }
      if (await stateManager.getActiveScan() !== scanId) {
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '⏹️ Scan cancelled.');
        return;
      }

      await Promise.all(repos.slice(i, i + 5).map(async (repo) => {
        const [owner, name] = repo.full_name.split('/');
        try {
          let tracked = await stateManager.getTrackedRepo(owner, name);
          if (!tracked) {
            tracked = {
              id: `${owner}/${name}`, name, owner, state: 'analyzing',
              analysis: null, analyzed_at: null, pending_action: null, pending_since: null,
              last_message_id: null, last_push_at: repo.pushed_at, killed_at: null, shipped_at: null,
              cover_image_url: null,
            };
          }

          if (tracked.state === 'shipped' || tracked.state === 'dead') {
            cached++; analyzed.push(tracked); await updateProgress(); return;
          }

          const hasAnalysis = tracked.analysis !== null;
          const hasNewCommits = new Date(repo.pushed_at).getTime() > (tracked.analyzed_at ? new Date(tracked.analyzed_at).getTime() : 0);
          if (hasAnalysis && !hasNewCommits) {
            cached++; analyzed.push(tracked); await updateProgress(); return;
          }

          const analysis = await getAnalyzer().analyzeRepo(owner, name);
          tracked.analysis = analysis;
          tracked.analyzed_at = new Date().toISOString();
          tracked.last_push_at = repo.pushed_at;
          tracked.state = verdictToState(analysis.verdict);
          await stateManager.saveTrackedRepo(tracked);
          analyzed.push(tracked);
          await updateProgress();
        } catch (error) {
          errors.push(`${name}: ${error instanceof Error ? error.message : 'Unknown'}`);
          await updateProgress();
        }
      }));
    }

    if (await stateManager.getActiveScan() !== scanId) {
      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '⏹️ Scan cancelled.');
      return;
    }

    try { await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id); } catch { /* ignore */ }

    const groups: GroupedRepos = {
      ship: analyzed.filter(r => r.analysis?.verdict === 'ship'),
      cut: analyzed.filter(r => r.analysis?.verdict === 'cut_to_core'),
      no_core: analyzed.filter(r => r.analysis?.verdict === 'no_core'),
      dead: analyzed.filter(r => r.analysis?.verdict === 'dead'),
      shipped: analyzed.filter(r => r.state === 'shipped'),
    };

    await stateManager.saveScanResult(scanId, {
      total: repos.length, analyzed: analyzed.length,
      ready: groups.ship.length, cut_to_core: groups.cut.length,
      no_core: groups.no_core.length, dead: groups.dead.length, shipped: groups.shipped.length,
    });

    const partial = timedOut || analyzed.length + errors.length < repos.length;
    let summary = formatScanSummary(groups);
    if (partial) summary = `⚠️ **Partial scan** (${analyzed.length}/${repos.length} - ${timedOut ? 'timeout' : 'incomplete'})\n\n` + summary;
    await ctx.reply(summary, { parse_mode: 'Markdown', reply_markup: summaryKeyboard(groups) });
    await stateManager.cancelActiveScan();

    if (errors.length > 0) {
      await ctx.reply(`⚠️ ${errors.length} failed:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n... and ${errors.length - 5} more` : ''}`);
    }
  } catch (error) {
    await stateManager.cancelActiveScan();
    await ctx.reply(`❌ Scan failed: ${error instanceof Error ? error.message : 'Unknown'}`, { reply_markup: retryKeyboard() });
  }
}

// ============ BUTTON HANDLERS ============

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const parts = data.split(':');
  const action = parts[0];
  
  // ============ NEW SESSION-BASED CARD ACTIONS ============
  // Format: action:sessionId:version[:extra]
  
  const sessionActions = ['do', 'skip', 'deep', 'back', 'ship', 'shipok', 'done', 'dostep'];
  
  if (sessionActions.includes(action)) {
    const sessionId = parts[1];
    const version = parseInt(parts[2], 10);
    
    // Get session from KV
    const session = await getCardSession(sessionId);
    if (!session) {
      await ctx.answerCallbackQuery({ text: 'Session expired. Use /next' });
      return;
    }
    
    // Stale callback guard
    if (session.version !== version) {
      await ctx.answerCallbackQuery({ text: 'Outdated button. Card has changed.' });
      return;
    }
    
    // Get message info FROM THE CALLBACK (not global state)
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatIdNum = ctx.chat?.id;
    if (!messageId || !chatIdNum) {
      await ctx.answerCallbackQuery({ text: 'Error: missing message context' });
      return;
    }
    
    const card = session.card;
    const [owner, name] = card.full_name.split('/');
    
    switch (action) {
      case 'deep': {
        await showTyping(ctx);
        
        try {
          // Get additional context for deep dive
          const [readme, fileTree] = await Promise.all([
            getGitHub().getFileContent(owner, name, 'README.md'),
            getGitHub().getRepoTree(owner, name, 30),
          ]);
          
          // Generate full deep dive with AI
          const deepDive = await generateDeepDive(getAnthropic(), {
            repo_card: card,
            readme_excerpt: readme || undefined,
            file_tree: fileTree,
          });
          
          const deployUrl = card.stage === 'ready_to_launch' || card.stage === 'post_launch' 
            ? `https://${name}.vercel.app` 
            : null;
          
          const deepDiveText = formatDeepDiveMessage(deepDive, name, deployUrl);
          
          // Update session
          const newSession = await updateCardSession(sessionId, { view: 'deep' });
          
          // Edit the message in place
          await ctx.api.editMessageText(
            chatIdNum, 
            messageId,
            deepDiveText,
            { 
              parse_mode: 'Markdown', 
              reply_markup: deepDiveKeyboard(sessionId, newSession!.version),
            }
          );
          await ctx.answerCallbackQuery();
        } catch (error) {
          console.error('Error in deep:', error);
          await ctx.answerCallbackQuery({ text: 'Failed to load deep dive' });
        }
        break;
      }
      
      case 'back': {
        // Edit back to card view
        const newSession = await updateCardSession(sessionId, { view: 'card' });
        
        await ctx.api.editMessageText(
          chatIdNum,
          messageId,
          formatRepoCard(card),
          { 
            parse_mode: 'Markdown', 
            reply_markup: cardKeyboard(sessionId, newSession!.version),
          }
        );
        await ctx.answerCallbackQuery();
        break;
      }
      
      case 'skip': {
        await markCardSkipped(card.full_name);
        
        // Get next card and edit in place
        await showTyping(ctx);
        try {
          const repos = await stateManager.getAllTrackedRepos();
          const nextCard = await getNextCard(getAnthropic(), getGitHub(), repos);
          
          if (!nextCard) {
            await ctx.api.editMessageText(chatIdNum, messageId, formatNoMoreCards(), {
              parse_mode: 'Markdown',
              reply_markup: noMoreCardsKeyboard(),
            });
          } else {
            // Create new session for next card
            const newSession = await createCardSession(nextCard);
            
            // Edit to show next card
            await ctx.api.editMessageText(
              chatIdNum,
              messageId,
              formatRepoCard(nextCard),
              { 
                parse_mode: 'Markdown', 
                reply_markup: cardKeyboard(newSession.id, newSession.version),
              }
            );
            await markCardShown(nextCard.full_name);
          }
          await ctx.answerCallbackQuery({ text: '⏭️ Skipped' });
        } catch (error) {
          console.error('Error in skip:', error);
          await ctx.answerCallbackQuery({ text: 'Failed to get next card' });
        }
        break;
      }
      
      case 'ship': {
        // Show confirmation (two-step)
        const newSession = await updateCardSession(sessionId, { view: 'confirm_ship' });
        
        await ctx.api.editMessageText(
          chatIdNum,
          messageId,
          formatShipConfirm(card.repo),
          { 
            parse_mode: 'Markdown', 
            reply_markup: shipConfirmKeyboard(sessionId, newSession!.version),
          }
        );
        await ctx.answerCallbackQuery();
        break;
      }
      
      case 'shipok': {
        // Actually ship it
        await stateManager.updateRepoState(owner, name, 'shipped');
        await clearIntention(card.full_name);
        
        await ctx.api.editMessageText(
          chatIdNum,
          messageId,
          formatShipped(card.repo),
          { parse_mode: 'Markdown' }
        );
        await ctx.answerCallbackQuery({ text: '🚀 Shipped!' });
        break;
      }
      
      case 'do':
      case 'dostep': {
        await showTyping(ctx);
        
        try {
          const artifactType = card.next_step.artifact.type;
          let artifactText = '';
          
          // Generate appropriate artifact based on type
          switch (artifactType) {
            case 'cursor_prompt': {
              const fileTree = await getGitHub().getRepoTree(owner, name, 50);
              const readme = await getGitHub().getFileContent(owner, name, 'README.md');
              
              const prompt = await generateCursorPromptArtifact(getAnthropic(), {
                repo_name: name,
                next_step_action: card.next_step.action,
                target_files_candidates: fileTree,
                readme_excerpt: readme || undefined,
              });
              
              artifactText = formatCursorPromptMessage(prompt);
              break;
            }
            
            case 'copy': {
              const copy = await generateCopy(getAnthropic(), {
                potential: card.potential,
                cta_style: 'direct_link',
                product_url: `https://${name}.vercel.app`,
              });
              
              artifactText = formatCopyMessage(copy);
              break;
            }
            
            case 'launch_post': {
              const post = await generateLaunchPost(getAnthropic(), {
                potential: card.potential,
                product_url: `https://${name}.vercel.app`,
                platform: 'x',
              });
              
              artifactText = formatLaunchPostMessage(post);
              break;
            }
            
            case 'checklist': {
              artifactText = `**☑️ Checklist: ${card.next_step.action}**

☐ Check environment variables are set
☐ Verify configuration files
☐ Test locally
☐ Deploy and verify

_Mark done when complete._`;
              break;
            }
            
            case 'command': {
              artifactText = `**🖥️ Command to run:**\n\n\`\`\`\n${card.next_step.action}\n\`\`\`\n\n_Run this and mark done._`;
              break;
            }
            
            default: {
              // Fallback to cursor prompt
              const fileTree = await getGitHub().getRepoTree(owner, name, 50);
              const readme = await getGitHub().getFileContent(owner, name, 'README.md');
              
              const prompt = await generateCursorPromptArtifact(getAnthropic(), {
                repo_name: name,
                next_step_action: card.next_step.action,
                target_files_candidates: fileTree,
                readme_excerpt: readme || undefined,
              });
              
              artifactText = formatCursorPromptMessage(prompt);
            }
          }
          
          // Send artifact as REPLY to group with card
          await ctx.reply(artifactText, {
            parse_mode: 'Markdown',
            reply_to_message_id: messageId,
          });
          
          // Update card to show artifact was sent
          const newSession = await updateCardSession(sessionId, { view: 'card' });
          await ctx.api.editMessageText(
            chatIdNum,
            messageId,
            formatRepoCardWithArtifact(card),
            { 
              parse_mode: 'Markdown', 
              reply_markup: afterDoItKeyboard(sessionId, newSession!.version),
            }
          );
          await ctx.answerCallbackQuery({ text: '⚡ Generated' });
        } catch (error) {
          console.error('Error in do:', error);
          await ctx.answerCallbackQuery({ text: 'Failed to generate artifact' });
        }
        break;
      }
      
      case 'done': {
        await clearIntention(card.full_name);
        
        // Get next card and edit in place
        await showTyping(ctx);
        try {
          const repos = await stateManager.getAllTrackedRepos();
          const nextCard = await getNextCard(getAnthropic(), getGitHub(), repos);
          
          if (!nextCard) {
            await ctx.api.editMessageText(chatIdNum, messageId, formatNoMoreCards(), {
              parse_mode: 'Markdown',
              reply_markup: noMoreCardsKeyboard(),
            });
          } else {
            const newSession = await createCardSession(nextCard);
            await ctx.api.editMessageText(
              chatIdNum,
              messageId,
              formatRepoCard(nextCard),
              { 
                parse_mode: 'Markdown', 
                reply_markup: cardKeyboard(newSession.id, newSession.version),
              }
            );
            await markCardShown(nextCard.full_name);
          }
          await ctx.answerCallbackQuery({ text: '✅ Done!' });
        } catch (error) {
          console.error('Error in done:', error);
          await ctx.answerCallbackQuery({ text: 'Failed to get next card' });
        }
        break;
      }
    }
    
    return;
  }
  
  // ============ LEGACY CARD ACTIONS (for backwards compatibility) ============
  
  await ctx.answerCallbackQuery();
  
  // card_next - Get next card (same as /next)
  if (action === 'card_next') {
    await showTyping(ctx);
    try {
      const repos = await stateManager.getAllTrackedRepos();
      const card = await getNextCard(getAnthropic(), getGitHub(), repos);
      
      if (!card) {
        await ctx.reply(formatNoMoreCards(), {
          parse_mode: 'Markdown',
          reply_markup: noMoreCardsKeyboard(),
        });
        return;
      }
      
      const session = await createCardSession(card);
      await markCardShown(card.full_name);
      
      await ctx.reply(formatRepoCard(card), {
        parse_mode: 'Markdown',
        reply_markup: cardKeyboard(session.id, session.version),
        link_preview_options: card.cover_image_url ? {
          url: card.cover_image_url,
          show_above_text: true,
          prefer_large_media: true,
        } : undefined,
      });
    } catch (error) {
      await ctx.reply(`❌ Failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    return;
  }
  
  // card_doit - Legacy: Generate artifact (for webhook/cron callbacks)
  if (action === 'card_doit') {
    const fullName = parts.slice(1).join(':');
    await showTyping(ctx);
    
    try {
      const [owner, name] = fullName.split('/');
      const repo = await stateManager.getTrackedRepo(owner, name);
      if (!repo) {
        await ctx.reply('Repo not found. Try /next for a new card.');
        return;
      }
      const card = await generateCard(getAnthropic(), getGitHub(), repo);
      
      const fileTree = await getGitHub().getRepoTree(owner, name, 50);
      const readme = await getGitHub().getFileContent(owner, name, 'README.md');
      
      const prompt = await generateCursorPromptArtifact(getAnthropic(), {
        repo_name: name,
        next_step_action: card.next_step.action,
        target_files_candidates: fileTree,
        readme_excerpt: readme || undefined,
      });
      
      // Create session for new keyboard
      const session = await createCardSession(card);
      
      await ctx.reply(formatCursorPromptMessage(prompt), {
        parse_mode: 'Markdown',
        reply_markup: afterDoItKeyboard(session.id, session.version),
      });
    } catch (error) {
      console.error('Error in card_doit:', error);
      await ctx.reply(`❌ Failed to generate artifact: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    return;
  }
  
  // card_skip - Legacy: Skip this card
  if (action === 'card_skip') {
    const fullName = parts.slice(1).join(':');
    await markCardSkipped(fullName);
    
    await showTyping(ctx);
    try {
      const repos = await stateManager.getAllTrackedRepos();
      const card = await getNextCard(getAnthropic(), getGitHub(), repos);
      
      if (!card) {
        await ctx.reply(formatNoMoreCards(), {
          parse_mode: 'Markdown',
          reply_markup: noMoreCardsKeyboard(),
        });
        return;
      }
      
      const session = await createCardSession(card);
      await markCardShown(card.full_name);
      
      await ctx.reply(formatRepoCard(card), {
        parse_mode: 'Markdown',
        reply_markup: cardKeyboard(session.id, session.version),
        link_preview_options: card.cover_image_url ? {
          url: card.cover_image_url,
          show_above_text: true,
          prefer_large_media: true,
        } : undefined,
      });
    } catch (error) {
      await ctx.reply(`❌ Failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    return;
  }
  
  // card_done - Legacy: Mark task done
  if (action === 'card_done') {
    const fullName = parts.slice(1).join(':');
    await clearIntention(fullName);
    
    await ctx.reply(`✅ Nice work! Getting your next card...`);
    
    await showTyping(ctx);
    try {
      const repos = await stateManager.getAllTrackedRepos();
      const card = await getNextCard(getAnthropic(), getGitHub(), repos);
      
      if (!card) {
        await ctx.reply(formatNoMoreCards(), {
          parse_mode: 'Markdown',
          reply_markup: noMoreCardsKeyboard(),
        });
        return;
      }
      
      const session = await createCardSession(card);
      await markCardShown(card.full_name);
      
      await ctx.reply(formatRepoCard(card), {
        parse_mode: 'Markdown',
        reply_markup: cardKeyboard(session.id, session.version),
        link_preview_options: card.cover_image_url ? {
          url: card.cover_image_url,
          show_above_text: true,
          prefer_large_media: true,
        } : undefined,
      });
    } catch (error) {
      await ctx.reply(`❌ Failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    return;
  }
  
  // card_deeper - Legacy: Show deep dive view
  if (action === 'card_deeper') {
    const fullName = parts.slice(1).join(':');
    await showTyping(ctx);
    
    try {
      const [owner, name] = fullName.split('/');
      const repo = await stateManager.getTrackedRepo(owner, name);
      if (!repo) {
        await ctx.reply('Repo not found.');
        return;
      }
      const card = await generateCard(getAnthropic(), getGitHub(), repo);
      
      const [readme, fileTree] = await Promise.all([
        getGitHub().getFileContent(owner, name, 'README.md'),
        getGitHub().getRepoTree(owner, name, 30),
      ]);
      
      const deepDive = await generateDeepDive(getAnthropic(), {
        repo_card: card,
        readme_excerpt: readme || undefined,
        file_tree: fileTree,
      });
      
      const deployUrl = card.stage === 'ready_to_launch' || card.stage === 'post_launch' 
        ? `https://${name}.vercel.app` 
        : null;
      
      const deepDiveText = formatDeepDiveMessage(deepDive, name, deployUrl);
      
      // Create session for back navigation
      const session = await createCardSession(card);
      await updateCardSession(session.id, { view: 'deep' });
      
      await ctx.reply(deepDiveText, {
        parse_mode: 'Markdown',
        reply_markup: deepDiveKeyboard(session.id, session.version + 1),
      });
    } catch (error) {
      console.error('Error in card_deeper:', error);
      await ctx.reply(`❌ Failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    return;
  }
  
  // card_shipped - Legacy: Mark repo as shipped
  if (action === 'card_shipped') {
    const fullName = parts.slice(1).join(':');
    const [owner, name] = fullName.split('/');
    
    await stateManager.updateRepoState(owner, name, 'shipped');
    await clearIntention(fullName);
    
    await ctx.reply(`🚀 **${name}** shipped! Congrats!\n\nReply with traction like "50 likes" or feedback to keep the momentum going.`, {
      parse_mode: 'Markdown',
      reply_markup: nextActionsKeyboard(),
    });
    return;
  }
  
  // card_live - Open live URL
  if (action === 'card_live') {
    const fullName = parts.slice(1).join(':');
    const [, name] = fullName.split('/');
    const url = `https://${name}.vercel.app`;
    await ctx.reply(`🔗 **${name}** live at:\n${url}`, { parse_mode: 'Markdown' });
    return;
  }
  
  // intention_confirm - Confirm intention reminder
  if (action === 'intention_confirm') {
    const fullName = parts[1] + '/' + parts[2];
    const encodedAction = parts.slice(3).join(':');
    const action_text = decodeURIComponent(encodedAction);
    
    await saveIntention(fullName, action_text, 24);
    await ctx.reply(`✅ Got it! I'll remind you about "${action_text}" tomorrow if there's no activity.`);
    return;
  }
  
  // intention_cancel - Cancel intention
  if (action === 'intention_cancel') {
    await ctx.reply(`👍 No reminder set.`);
    return;
  }

  // ============ GLOBAL ACTIONS ============
  
  if (action === 'quickscan') {
    const activeScan = await stateManager.getActiveScan();
    if (activeScan) {
      await ctx.answerCallbackQuery({ text: 'Scan already in progress' });
      return;
    }
    await runScan(ctx, 10);
    return;
  }
  if (action === 'showstatus') {
    await ctx.reply(formatStatus(await stateManager.getRepoCounts()), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan').text('📋 List All', 'listall'),
    });
    return;
  }
  if (action === 'listall' || action === 'summary') {
    const all = await stateManager.getAllTrackedRepos();
    if (all.length === 0) { await ctx.reply('No repos tracked yet. Run /scan to get started.'); return; }
    const groups: GroupedRepos = {
      ship: all.filter(r => r.state === 'ready'), cut: all.filter(r => r.state === 'has_core'),
      no_core: all.filter(r => r.state === 'no_core'), dead: all.filter(r => r.state === 'dead'),
      shipped: all.filter(r => r.state === 'shipped'),
    };
    await ctx.reply(formatScanSummary(groups), { parse_mode: 'Markdown', reply_markup: summaryKeyboard(groups) });
    return;
  }
  if (action === 'category') {
    const category = parts[1] as CategoryKey;
    const page = parseInt(parts[2] || '0', 10);
    
    const all = await stateManager.getAllTrackedRepos();
    let filtered: TrackedRepo[];
    
    switch (category) {
      case 'ship': filtered = all.filter(r => r.state === 'ready'); break;
      case 'cut': filtered = all.filter(r => r.state === 'has_core'); break;
      case 'no_core': filtered = all.filter(r => r.state === 'no_core'); break;
      case 'dead': filtered = all.filter(r => r.state === 'dead'); break;
      case 'shipped': filtered = all.filter(r => r.state === 'shipped'); break;
      case 'all': default: filtered = all; break;
    }
    
    const { message, hasMore } = formatCategoryView(category, filtered, page);
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: categoryKeyboard(category, filtered, page, hasMore) });
    return;
  }
  if (action === 'repo') {
    const owner = parts[1];
    const name = parts[2];
    const repo = await stateManager.getTrackedRepo(owner, name);
    if (!repo) { await ctx.reply('Repo not found.'); return; }
    const msg = await ctx.reply(formatAnalysis(repo), { parse_mode: 'Markdown', reply_markup: analysisKeyboard(repo) });
    await stateManager.setMessageRepo(msg.message_id, owner, name);
    return;
  }

  // Repo-specific actions (format: action:owner:name)
  const owner = parts[1];
  const name = parts[2];
  const repo = await stateManager.getTrackedRepo(owner, name);

  if (action === 'retryname') {
    await showTyping(ctx);
    await ctx.reply(`⏳ Retrying analysis for ${owner}...`);
    try {
      const allRepos = await getGitHub().getUserRepos();
      const found = allRepos.find(r => r.name.toLowerCase() === owner.toLowerCase());
      if (!found) { await ctx.reply(`❌ Repo "${owner}" not found.`); return; }
      const [o, n] = found.full_name.split('/');
      const analysis = await getAnalyzer().analyzeRepo(o, n);
      const tracked: TrackedRepo = {
        id: `${o}/${n}`, name: n, owner: o, state: verdictToState(analysis.verdict),
        analysis, analyzed_at: new Date().toISOString(),
        pending_action: null, pending_since: null, last_message_id: null,
        last_push_at: found.pushed_at, killed_at: null, shipped_at: null,
        cover_image_url: null,
      };
      await stateManager.saveTrackedRepo(tracked);
      const msg = await ctx.reply(formatAnalysis(tracked), { parse_mode: 'Markdown', reply_markup: analysisKeyboard(tracked) });
      await stateManager.setMessageRepo(msg.message_id, o, n);
    } catch (error) {
      await ctx.reply(`❌ Retry failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    return;
  }

  if (!repo) { await ctx.reply(`Repo not found. Try /scan to refresh.`); return; }

  switch (action) {
    case 'kill':
      await stateManager.updateRepoState(owner, name, 'dead');
      await ctx.reply(`☠️ **${name}** killed. Off your plate.`, { parse_mode: 'Markdown', reply_markup: nextActionsKeyboard() });
      break;

    case 'ship':
      if (repo.analysis?.tweet_draft) {
        await ctx.reply(`🚀 **${name}** ready!\n\n**Tweet:**\n\`\`\`\n${repo.analysis.tweet_draft}\n\`\`\`\n\nCopy and post, then tap "Posted!"`, {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('✏️ Edit Tone', `edit:${owner}:${name}`).text('✅ Posted!', `shipped:${owner}:${name}`),
        });
      } else {
        await ctx.reply(`🚀 **${name}** marked ready. Generate a tweet with /repo ${name}`, { parse_mode: 'Markdown' });
      }
      await stateManager.updateRepoState(owner, name, 'ready');
      break;

    case 'shipped':
      await stateManager.updateRepoState(owner, name, 'shipped');
      await ctx.reply(`🚀 **${name}** shipped! Nice work.\n\nReply with traction like "50 likes" or feedback.`, {
        parse_mode: 'Markdown', reply_markup: nextActionsKeyboard(),
      });
      break;

    case 'cut':
      await ctx.reply(`✂️ **Cut to core: ${name}**\n\nPaste into Cursor:\n\n\`\`\`\n${formatCursorPrompt(repo)}\n\`\`\``, {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('✅ Done, Re-analyze', `reanalyze:${owner}:${name}`).text('❌ Cancel', `cancelaction:${owner}:${name}`),
      });
      await stateManager.setPendingAction(owner, name, 'cut_to_core');
      break;

    case 'reanalyze':
      await reanalyzeRepo(ctx, repo, getAnalyzer(), 'Re-analyzing', { clearPending: true });
      break;

    case 'deeper':
      await reanalyzeRepo(ctx, repo, getAnalyzer(), 'Re-analyzing in depth');
      break;

    case 'revive':
      await reanalyzeRepo(ctx, repo, getAnalyzer(), 'Reviving', { clearKilled: true });
      break;

    case 'retry':
      await reanalyzeRepo(ctx, repo, getAnalyzer(), 'Retrying analysis for');
      break;

    case 'cancelaction':
      await stateManager.setPendingAction(owner, name, null);
      await ctx.reply(`Cancelled. **${name}** unchanged.`, { parse_mode: 'Markdown' });
      break;

    case 'skip':
      await ctx.reply(`⏸️ **${name}** skipped for now.`, { parse_mode: 'Markdown' });
      break;

    case 'edit':
      await ctx.reply('What tone for the tweet?', {
        reply_markup: new InlineKeyboard()
          .text('Casual', `tone:${owner}:${name}:casual`).text('Professional', `tone:${owner}:${name}:pro`).row()
          .text('Technical', `tone:${owner}:${name}:tech`).text('Hype', `tone:${owner}:${name}:hype`).row()
          .text('❌ Keep Original', `ship:${owner}:${name}`),
      });
      break;

    case 'tone':
      const tone = parts[2];
      await showTyping(ctx);
      try {
        const newTweet = await getAnalyzer().regenerateTweet(repo, tone);
        if (repo.analysis) {
          repo.analysis.tweet_draft = newTweet;
          await stateManager.saveTrackedRepo(repo);
        }
        const label = { casual: 'Casual', pro: 'Professional', tech: 'Technical', hype: 'Hype' }[tone] || tone;
        await ctx.reply(`**${label} version:**\n\n\`\`\`\n${newTweet}\n\`\`\``, {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('✅ Use This', `ship:${owner}:${name}`).text('🔄 Try Again', `edit:${owner}:${name}`),
        });
      } catch (error) {
        await ctx.reply(`❌ Failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
      break;

    case 'cover':
      try {
        // Show upload action while generating
        if (ctx.chat) await ctx.api.sendChatAction(ctx.chat.id, 'upload_photo');
        
        // Generate cover image
        const imageBuffer = await generateRepoCover(repo);
        
        // Send the photo
        await ctx.replyWithPhoto(new InputFile(imageBuffer, `${name}-cover.png`), {
          caption: `🎨 **${name}** cover\n\n${repo.analysis?.one_liner || ''}`,
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('🔄 Regenerate', `cover:${owner}:${name}`)
            .text('📋 Back to Analysis', `repo:${owner}:${name}`),
        });
      } catch (error) {
        await ctx.reply(`❌ Cover generation failed: ${error instanceof Error ? error.message : 'Unknown'}`, {
          reply_markup: new InlineKeyboard().text('🔄 Retry', `cover:${owner}:${name}`),
        });
      }
      break;
  }
});

// ============ TEXT MESSAGE HANDLER ============

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (ctx.from?.id.toString() !== chatId || text.startsWith('/')) return;

  const replyTo = ctx.message.reply_to_message;
  let targetRepo: TrackedRepo | null = null;
  if (replyTo) {
    const ref = await stateManager.getMessageRepo(replyTo.message_id);
    if (ref) targetRepo = await stateManager.getTrackedRepo(ref.owner, ref.name);
  }

  const lower = text.toLowerCase().trim();

  // Repo name lookup
  const allRepos = await stateManager.getAllTrackedRepos();
  const matched = allRepos.find(r => r.name.toLowerCase() === lower || r.name.toLowerCase().replace(/-/g, '') === lower.replace(/-/g, ''));
  if (matched) {
    const msg = await ctx.reply(formatAnalysis(matched), { parse_mode: 'Markdown', reply_markup: analysisKeyboard(matched) });
    await stateManager.setMessageRepo(msg.message_id, matched.owner, matched.name);
    return;
  }

  // "done" / "pushed"
  if (['done', 'pushed', 'fixed', 'finished'].some(w => lower.includes(w))) {
    if (targetRepo?.pending_action) {
      await reanalyzeRepo(ctx, targetRepo, getAnalyzer(), 'Checking', { clearPending: true });
    } else {
      await ctx.reply(`What repo are you done with? Reply to the analysis message or type the repo name.`);
    }
    return;
  }

  // "kill"
  if (['kill', 'kill it', 'dead', 'delete'].some(w => lower === w || lower.startsWith(w + ' '))) {
    if (targetRepo) {
      await stateManager.updateRepoState(targetRepo.owner, targetRepo.name, 'dead');
      await ctx.reply(`☠️ **${targetRepo.name}** killed.`, { parse_mode: 'Markdown', reply_markup: nextActionsKeyboard() });
    }
    return;
  }

  // "ship" / "shipped"
  if (['ship', 'shipped', 'posted', 'launched'].some(w => lower === w || lower.startsWith(w + ' '))) {
    if (targetRepo) {
      await stateManager.updateRepoState(targetRepo.owner, targetRepo.name, 'shipped');
      await ctx.reply(`🚀 **${targetRepo.name}** shipped!`, { parse_mode: 'Markdown', reply_markup: nextActionsKeyboard() });
    }
    return;
  }

  // Traction/feedback
  if (targetRepo) {
    const traction = text.match(/(\d+)\s*(likes?|stars?|users?|signups?)/i);
    const feature = text.match(/(?:people|they|users?)\s+(?:want|asking for|need)\s+(.+)/i);
    if (traction || feature) {
      let msg = `📊 **${targetRepo.name}** feedback noted.\n\n`;
      if (traction) msg += `**Traction:** ${traction[1]} ${traction[2]} — solid signal!\n`;
      if (feature) msg += `**Feature request:** ${feature[1].trim()}\n\nWant a Cursor prompt to add this?`;
      await ctx.reply(msg, { parse_mode: 'Markdown' });
      return;
    }
  }

  await ctx.reply(`Didn't catch that. Type a repo name for details, or:`, {
    reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan').text('📋 Status', 'showstatus'),
  });
});

// ============ WEBHOOK ============

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const update = await req.json() as Update;
    console.log('Update:', JSON.stringify({
      type: update.message ? 'msg' : update.callback_query ? 'cb' : '?',
      from: update.message?.from?.id || update.callback_query?.from?.id,
      data: (update.message?.text || update.callback_query?.data || '').substring(0, 50),
    }));
    await bot.handleUpdate(update);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
