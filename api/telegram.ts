export const config = { runtime: 'edge', maxDuration: 60 };

import { Bot, InlineKeyboard, Context, InputFile } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import Anthropic from '@anthropic-ai/sdk';
import { info, error as logErr } from '../lib/logger.js';
import { RepoAnalyzer } from '../lib/analyzer.js';
import { stateManager } from '../lib/state.js';
import { GitHubClient } from '../lib/github.js';
import { TrackedRepo } from '../lib/core-types.js';
import { handleRepo, handleRepoDetails, handleRepoBack } from '../lib/bot/handlers/repo.js';
import { handleWatch, handleUnwatch, handleWatching, handleMute } from '../lib/bot/handlers/watch.js';
import {
  formatProgress, formatScanSummary, formatCategoryView, formatStatus, formatCard, formatDetails,
  formatCursorPrompt, formatRepoCard, formatNoMoreCards, formatCompletion,
  formatShipConfirm, formatShipped, formatRepoCardWithArtifact,
  GroupedRepos, CategoryKey,
} from '../lib/bot/format.js';
import {
  summaryKeyboard, categoryKeyboard,
  cardKeyboard, afterDoItKeyboard, deepDiveKeyboard, noMoreCardsKeyboard,
  shipConfirmKeyboard,
} from '../lib/bot/keyboards.js';
import { createCardSession, getCardSession, updateCardSession } from '../lib/card-session.js';
import { verdictToState, reanalyzeRepo } from '../lib/bot/actions.js';
import { generateRepoCover } from '../lib/nano-banana.js';
import { 
  generateCard, getNextCard, markCardShown, markCardSkipped, clearIntention,
} from '../lib/card-generator.js';
import { 
  generateCursorPromptArtifact, formatCursorPromptMessage,
  generateCopy, formatCopyMessage,
  generateLaunchPost, formatLaunchPostMessage,
  generateDeepDive, formatDeepDiveMessage,
} from '../lib/ai/index.js';

// ============ SETUP ============

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!, {
  botInfo: getBotInfo(process.env.TELEGRAM_BOT_TOKEN!),
});
const chatId = process.env.USER_TELEGRAM_CHAT_ID!.trim();

let analyzer: RepoAnalyzer | null = null;
let github: GitHubClient | null = null;
let anthropic: Anthropic | null = null;

function getBotInfo(token: string): UserFromGetMe {
  return {
    id: parseInt(token.split(':')[0], 10), is_bot: true, first_name: 'ShipBot',
    username: 'ship_or_kill_bot', can_join_groups: true, can_read_all_group_messages: false,
    supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
  };
}

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
  info('cmd', '/start', { from: ctx.from?.id });
  const counts = await stateManager.getRepoCounts();
  const parts = [];
  if (counts.ready > 0) parts.push(`${counts.ready} ready to ship`);
  if (counts.has_core > 0) parts.push(`${counts.has_core} need focus`);
  if (counts.shipped > 0) parts.push(`${counts.shipped} shipped`);
  const status = parts.length > 0 ? `\n\n📊 ${parts.join(', ')}.` : '';
  await ctx.reply(
    `**Ship or Kill**\n\nI analyze your repos and help you decide: ship it, cut to core, or kill it.${status}\n\n/help for commands`,
    { parse_mode: 'Markdown', reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan').text('📋 Status', 'showstatus') }
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(`**Commands**
/next — Get your next task card
/scan — Analyze recent repos
/repo <name> — Deep dive one repo
/status — See repo counts
/watch <repo> — Get push notifications
/unwatch <repo> — Stop notifications
/watching — List watched repos
/cancel — Cancel running scan`, { parse_mode: 'Markdown' });
});

bot.command('next', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  info('cmd', '/next', { from: ctx.from?.id });
  await showTyping(ctx);
  
  try {
    const repos = await stateManager.getAllTrackedRepos();
    if (repos.length === 0) {
      await ctx.reply('No repos tracked. Run /scan first.', {
        reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan'),
      });
      return;
    }
    
    const card = await getNextCard(getAnthropic(), getGitHub(), repos);
    if (!card) {
      await ctx.reply(formatNoMoreCards(), { parse_mode: 'Markdown', reply_markup: noMoreCardsKeyboard() });
      return;
    }
    
    const session = await createCardSession(card);
    await markCardShown(card.full_name);
    
    await ctx.reply(formatRepoCard(card), {
      parse_mode: 'Markdown',
      reply_markup: cardKeyboard(session.id, session.version),
      link_preview_options: card.cover_image_url ? { url: card.cover_image_url, show_above_text: true, prefer_large_media: true } : undefined,
    });
  } catch (err) {
    logErr('cmd.next', err);
    await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Failed'}`);
  }
});

bot.command('scan', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  info('cmd', '/scan', { from: ctx.from?.id });
  
  const activeScan = await stateManager.getActiveScan();
  if (activeScan) {
    await ctx.reply('⏳ Scan already running. /cancel to stop.');
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
    reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan').text('📋 List', 'listall'),
  });
});

bot.command('repo', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  const input = (ctx.message?.text || '').replace('/repo', '').trim();
  if (!input) { await ctx.reply('Usage: /repo <name> or /repo owner/name'); return; }
  await handleRepo(ctx, input);
});

bot.command('watch', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  const input = (ctx.message?.text || '').replace('/watch', '').trim();
  if (!input) { await ctx.reply('Usage: /watch <repo>'); return; }
  await handleWatch(ctx, input);
});

bot.command('unwatch', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  const input = (ctx.message?.text || '').replace('/unwatch', '').trim();
  if (!input) { await ctx.reply('Usage: /unwatch <repo>'); return; }
  await handleUnwatch(ctx, input);
});

bot.command('watching', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
  await handleWatching(ctx);
});

// ============ SCAN ============

async function runScan(ctx: Context, days: number): Promise<void> {
  const startTime = Date.now();
  const TIMEOUT = 55000;
  const scanId = `scan_${Date.now()}`;
  
  info('scan', 'Starting', { days, scanId });
  await stateManager.setActiveScan(scanId);

  try {
    const progressMsg = await ctx.reply('🔍 Fetching repos...');
    const repos = await getGitHub().getRecentRepos(days);
    
    if (repos.length === 0) {
      await stateManager.cancelActiveScan();
      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, `No repos in last ${days} days.`);
      return;
    }

    await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, formatProgress(0, repos.length, 0, 0));
    
    const analyzed: TrackedRepo[] = [];
    const errors: string[] = [];
    let cached = 0;
    let lastUpdate = 0;

    const updateProgress = async () => {
      if (Date.now() - lastUpdate < 500) return;
      lastUpdate = Date.now();
      try {
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id,
          formatProgress(analyzed.length + errors.length, repos.length, cached, errors.length));
      } catch { /* rate limit */ }
    };

    for (let i = 0; i < repos.length; i += 5) {
      if (Date.now() - startTime > TIMEOUT) break;
      if (await stateManager.getActiveScan() !== scanId) {
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '⏹️ Cancelled.');
        return;
      }

      await Promise.all(repos.slice(i, i + 5).map(async (repo) => {
        const [owner, name] = repo.full_name.split('/');
        try {
          let tracked = await stateManager.getTrackedRepo(owner, name);
          
          // Skip shipped/dead
          if (tracked?.state === 'shipped' || tracked?.state === 'dead') {
            cached++;
            analyzed.push(tracked);
            await updateProgress();
            return;
          }

          // Skip if no new commits
          const hasAnalysis = tracked?.analysis !== null;
          const hasNewCommits = new Date(repo.pushed_at).getTime() > (tracked?.analyzed_at ? new Date(tracked.analyzed_at).getTime() : 0);
          if (hasAnalysis && !hasNewCommits && tracked) {
            cached++;
            analyzed.push(tracked);
            await updateProgress();
            return;
          }

          // Analyze
          const analysis = await getAnalyzer().analyzeRepo(owner, name);
          tracked = {
            id: `${owner}/${name}`, name, owner,
            state: verdictToState(analysis.verdict),
            analysis, analyzed_at: new Date().toISOString(),
            pending_action: null, pending_since: null, last_message_id: null,
            last_push_at: repo.pushed_at, killed_at: null, shipped_at: null,
            cover_image_url: tracked?.cover_image_url || null,
          };
          await stateManager.saveTrackedRepo(tracked);
          analyzed.push(tracked);
          await updateProgress();
        } catch (err) {
          errors.push(`${name}: ${err instanceof Error ? err.message : 'error'}`);
          await updateProgress();
        }
      }));
    }

    if (await stateManager.getActiveScan() !== scanId) {
      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '⏹️ Cancelled.');
      return;
    }

    try { await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id); } catch { /* ok */ }

    const groups: GroupedRepos = {
      ship: analyzed.filter(r => r.analysis?.verdict === 'ship'),
      cut: analyzed.filter(r => r.analysis?.verdict === 'cut_to_core'),
      no_core: analyzed.filter(r => r.analysis?.verdict === 'no_core'),
      dead: analyzed.filter(r => r.analysis?.verdict === 'dead'),
      shipped: analyzed.filter(r => r.state === 'shipped'),
    };

    info('scan', 'Complete', { analyzed: analyzed.length, errors: errors.length });
    await ctx.reply(formatScanSummary(groups), { parse_mode: 'Markdown', reply_markup: summaryKeyboard(groups) });
    await stateManager.cancelActiveScan();

    if (errors.length > 0) {
      await ctx.reply(`⚠️ ${errors.length} failed:\n${errors.slice(0, 3).join('\n')}`);
    }
  } catch (err) {
    logErr('scan', err);
    await stateManager.cancelActiveScan();
    await ctx.reply(`❌ Scan failed: ${err instanceof Error ? err.message : 'Unknown'}`);
  }
}

// ============ CALLBACKS ============

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const parts = data.split(':');
  const action = parts[0];
  
  info('cb', action, { data: data.substring(0, 50) });

  // Session-based card actions: action:sessionId:version
  // Note: 'back' handled separately below (can be session or repo)
  const sessionActions = ['do', 'skip', 'deep', 'ship', 'shipok', 'done', 'dostep'];
  if (sessionActions.includes(action)) {
    await handleSessionAction(ctx, action, parts);
    return;
  }
  
  // Handle 'back' - can be session-based (back:sessionId:version) or repo-based (back:owner:name)
  if (action === 'back') {
    const maybeVersion = parseInt(parts[2], 10);
    if (parts.length === 3 && !isNaN(maybeVersion) && parts[1].length < 20) {
      // Session-based back (sessionId is short, version is a number)
      await handleSessionAction(ctx, 'back', parts);
    } else {
      // Repo-based back (owner:name) - handler answers callback
      await handleRepoBack(ctx, parts[1], parts[2]);
    }
    return;
  }
  
  // Handle mute callbacks: mute:owner:name:duration
  if (action === 'mute') {
    const fullName = `${parts[1]}/${parts[2]}`;
    const duration = parts[3]; // 1d, 1w, or forever
    await handleMute(ctx, fullName, duration);
    return;
  }

  await ctx.answerCallbackQuery();

  // Global actions
  if (action === 'quickscan') {
    const active = await stateManager.getActiveScan();
    if (active) { await ctx.answerCallbackQuery({ text: 'Already scanning' }); return; }
    await runScan(ctx, 10);
    return;
  }

  if (action === 'showstatus') {
    const counts = await stateManager.getRepoCounts();
    await ctx.reply(formatStatus(counts), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan').text('📋 List', 'listall'),
    });
    return;
  }

  if (action === 'listall' || action === 'summary') {
    const all = await stateManager.getAllTrackedRepos();
    if (all.length === 0) { await ctx.reply('No repos. Run /scan first.'); return; }
    const groups: GroupedRepos = {
      ship: all.filter(r => r.state === 'ready'),
      cut: all.filter(r => r.state === 'has_core'),
      no_core: all.filter(r => r.state === 'no_core'),
      dead: all.filter(r => r.state === 'dead'),
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
      default: filtered = all;
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
    const msg = await ctx.reply(formatCard(repo), { parse_mode: 'Markdown', reply_markup: repoKeyboard(repo) });
    await stateManager.setMessageRepo(msg.message_id, owner, name);
    return;
  }

  // More for repo details (back handled above)
  if (action === 'more') {
    await handleRepoDetails(ctx, parts[1], parts[2]);
    return;
  }

  // Legacy card actions
  if (action === 'card_next') {
    await showTyping(ctx);
    try {
      const repos = await stateManager.getAllTrackedRepos();
      const card = await getNextCard(getAnthropic(), getGitHub(), repos);
      if (!card) {
        await ctx.reply(formatNoMoreCards(), { parse_mode: 'Markdown', reply_markup: noMoreCardsKeyboard() });
        return;
      }
      const session = await createCardSession(card);
      await markCardShown(card.full_name);
      await ctx.reply(formatRepoCard(card), {
        parse_mode: 'Markdown',
        reply_markup: cardKeyboard(session.id, session.version),
      });
    } catch (err) {
      logErr('cb.card_next', err);
      await ctx.reply(`❌ ${err instanceof Error ? err.message : 'Failed'}`);
    }
    return;
  }

  // Repo-specific actions: action:owner:name
  const owner = parts[1];
  const name = parts[2];
  const repo = await stateManager.getTrackedRepo(owner, name);

  if (!repo && action !== 'retryname') {
    await ctx.reply('Repo not found. Try /scan.');
    return;
  }

  switch (action) {
    case 'kill':
      await stateManager.updateRepoState(owner, name, 'dead');
      await ctx.reply(`☠️ **${name}** killed.`, { parse_mode: 'Markdown' });
      break;

    case 'ship':
      if (repo?.analysis?.tweet_draft) {
        await ctx.reply(`🚀 **${name}**\n\n\`\`\`\n${repo.analysis.tweet_draft}\n\`\`\`\n\nCopy and post!`, {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('✅ Posted!', `shipped:${owner}:${name}`),
        });
      }
      await stateManager.updateRepoState(owner, name, 'ready');
      break;

    case 'shipped':
      await stateManager.updateRepoState(owner, name, 'shipped');
      await ctx.reply(`🚀 **${name}** shipped!`, { parse_mode: 'Markdown' });
      break;

    case 'cut':
      await ctx.reply(`✂️ **${name}**\n\n\`\`\`\n${formatCursorPrompt(repo!)}\n\`\`\``, {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('✅ Done', `reanalyze:${owner}:${name}`),
      });
      break;

    case 'reanalyze':
      await reanalyzeRepo(ctx, repo!, getAnalyzer(), 'Re-analyzing', { clearPending: true });
      break;

    case 'retry':
      await reanalyzeRepo(ctx, repo!, getAnalyzer(), 'Retrying');
      break;

    case 'cover':
      try {
        if (ctx.chat) await ctx.api.sendChatAction(ctx.chat.id, 'upload_photo');
        const imageBuffer = await generateRepoCover(repo!);
        await ctx.replyWithPhoto(new InputFile(imageBuffer, `${name}-cover.png`), {
          caption: `🎨 **${name}**\n${repo?.analysis?.one_liner || ''}`,
          parse_mode: 'Markdown',
        });
      } catch (err) {
        logErr('cb.cover', err, { owner, name });
        await ctx.reply(`❌ Cover failed: ${err instanceof Error ? err.message : 'error'}`);
      }
      break;
  }
});

// Session-based card action handler
async function handleSessionAction(ctx: Context, action: string, parts: string[]): Promise<void> {
  const sessionId = parts[1];
  const version = parseInt(parts[2], 10);
  
  const session = await getCardSession(sessionId);
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'Session expired. /next' });
    return;
  }
  
  if (session.version !== version) {
    await ctx.answerCallbackQuery({ text: 'Outdated. Card changed.' });
    return;
  }
  
  const messageId = ctx.callbackQuery?.message?.message_id;
  const chatIdNum = ctx.chat?.id;
  if (!messageId || !chatIdNum) {
    await ctx.answerCallbackQuery({ text: 'Error' });
    return;
  }
  
  const card = session.card;
  const [owner, name] = card.full_name.split('/');
  
  switch (action) {
    case 'skip': {
      await markCardSkipped(card.full_name);
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
          await ctx.api.editMessageText(chatIdNum, messageId, formatRepoCard(nextCard), {
            parse_mode: 'Markdown',
            reply_markup: cardKeyboard(newSession.id, newSession.version),
          });
          await markCardShown(nextCard.full_name);
        }
        await ctx.answerCallbackQuery({ text: '⏭️ Skipped' });
      } catch (err) {
        logErr('cb.skip', err);
        await ctx.answerCallbackQuery({ text: 'Failed' });
      }
      break;
    }

    case 'deep': {
      await showTyping(ctx);
      try {
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
          ? `https://${name}.vercel.app` : null;
        
        const newSession = await updateCardSession(sessionId, { view: 'deep' });
        await ctx.api.editMessageText(chatIdNum, messageId, formatDeepDiveMessage(deepDive, name, deployUrl), {
          parse_mode: 'Markdown',
          reply_markup: deepDiveKeyboard(sessionId, newSession!.version),
        });
        await ctx.answerCallbackQuery();
      } catch (err) {
        logErr('cb.deep', err);
        await ctx.answerCallbackQuery({ text: 'Failed' });
      }
      break;
    }

    case 'back': {
      const newSession = await updateCardSession(sessionId, { view: 'card' });
      await ctx.api.editMessageText(chatIdNum, messageId, formatRepoCard(card), {
        parse_mode: 'Markdown',
        reply_markup: cardKeyboard(sessionId, newSession!.version),
      });
      await ctx.answerCallbackQuery();
      break;
    }

    case 'ship': {
      const newSession = await updateCardSession(sessionId, { view: 'confirm_ship' });
      await ctx.api.editMessageText(chatIdNum, messageId, formatShipConfirm(card.repo), {
        parse_mode: 'Markdown',
        reply_markup: shipConfirmKeyboard(sessionId, newSession!.version),
      });
      await ctx.answerCallbackQuery();
      break;
    }

    case 'shipok': {
      await stateManager.updateRepoState(owner, name, 'shipped');
      await clearIntention(card.full_name);
      await ctx.api.editMessageText(chatIdNum, messageId, formatShipped(card.repo), { parse_mode: 'Markdown' });
      await ctx.answerCallbackQuery({ text: '🚀 Shipped!' });
      break;
    }

    case 'do':
    case 'dostep': {
      await showTyping(ctx);
      try {
        let artifactText = '';
        const artifactType = card.next_step.artifact.type;
        
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
          default: {
            artifactText = `**${card.next_step.action}**\n\n_Complete this step and tap Done._`;
          }
        }
        
        await ctx.reply(artifactText, { parse_mode: 'Markdown', reply_to_message_id: messageId });
        
        const newSession = await updateCardSession(sessionId, { view: 'card' });
        await ctx.api.editMessageText(chatIdNum, messageId, formatRepoCardWithArtifact(card), {
          parse_mode: 'Markdown',
          reply_markup: afterDoItKeyboard(sessionId, newSession!.version),
        });
        await ctx.answerCallbackQuery({ text: '⚡ Generated' });
      } catch (err) {
        logErr('cb.do', err);
        await ctx.answerCallbackQuery({ text: 'Failed' });
      }
      break;
    }

    case 'done': {
      await clearIntention(card.full_name);
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
          await ctx.api.editMessageText(chatIdNum, messageId, formatRepoCard(nextCard), {
            parse_mode: 'Markdown',
            reply_markup: cardKeyboard(newSession.id, newSession.version),
          });
          await markCardShown(nextCard.full_name);
        }
        await ctx.answerCallbackQuery({ text: '✅ Done!' });
      } catch (err) {
        logErr('cb.done', err);
        await ctx.answerCallbackQuery({ text: 'Failed' });
      }
      break;
    }
  }
}

// Helper keyboard for repo card view
function repoKeyboard(repo: TrackedRepo): InlineKeyboard {
  const id = `${repo.owner}:${repo.name}`;
  const kb = new InlineKeyboard();
  const verdict = repo.analysis?.verdict;

  if (verdict === 'ship') {
    kb.text('🚀 Ship', `ship:${id}`);
  } else if (verdict === 'cut_to_core') {
    kb.text('✂️ Cut', `cut:${id}`);
  }
  kb.text('☠️ Kill', `kill:${id}`);
  kb.row();
  kb.text('📋 More', `more:${id}`);

  return kb;
}

// ============ TEXT HANDLER ============

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (ctx.from?.id.toString() !== chatId || text.startsWith('/')) return;

  const lower = text.toLowerCase().trim();

  // Repo name lookup
  const allRepos = await stateManager.getAllTrackedRepos();
  const matched = allRepos.find(r => 
    r.name.toLowerCase() === lower || 
    r.name.toLowerCase().replace(/-/g, '') === lower.replace(/-/g, '')
  );
  
  if (matched) {
    const msg = await ctx.reply(formatCard(matched), { parse_mode: 'Markdown', reply_markup: repoKeyboard(matched) });
    await stateManager.setMessageRepo(msg.message_id, matched.owner, matched.name);
    return;
  }

  await ctx.reply(`Type a repo name, or:`, {
    reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan').text('📋 Status', 'showstatus'),
  });
});

// ============ WEBHOOK ============

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const update = await req.json() as Update;
    info('webhook', 'Update', {
      type: update.message ? 'msg' : update.callback_query ? 'cb' : '?',
      from: update.message?.from?.id || update.callback_query?.from?.id,
      data: (update.message?.text || update.callback_query?.data || '').substring(0, 50),
    });
    await bot.handleUpdate(update);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    logErr('webhook', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
