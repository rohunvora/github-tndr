export const config = {
  runtime: 'edge',
  maxDuration: 60,
};

import { Bot, InlineKeyboard, Context } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { RepoAnalyzer } from '../lib/analyzer.js';
import { stateManager } from '../lib/state.js';
import { GitHubClient } from '../lib/github.js';
import { TrackedRepo } from '../lib/core-types.js';
import {
  formatProgress, formatScanDigest, formatStatus, formatAnalysis, formatCursorPrompt,
  GroupedRepos,
} from '../lib/bot/format.js';
import {
  analysisKeyboard, toneKeyboard, nextActionsKeyboard, startKeyboard, retryKeyboard,
} from '../lib/bot/keyboards.js';
import { verdictToState, reanalyzeRepo } from '../lib/bot/actions.js';

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

function getAnalyzer(): RepoAnalyzer {
  if (!analyzer) analyzer = new RepoAnalyzer(process.env.ANTHROPIC_API_KEY!, process.env.GITHUB_TOKEN!);
  return analyzer;
}

function getGitHub(): GitHubClient {
  if (!github) github = new GitHubClient(process.env.GITHUB_TOKEN!);
  return github;
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
/scan [days] — Analyze repos (default: 10 days)
/status — See repo counts by state
/repo <name> — Deep dive on one repo
/cancel — Cancel running scan

**Quick Actions**
Type a repo name to see its full analysis.
Reply to any analysis with:
• "done" / "pushed" — Re-analyze after changes
• "ship" / "shipped" — Mark as launched  
• "kill" — Remove from tracking

**States**
🟢 Ready to ship | 🟡 Needs focus | 🔴 No core
☠️ Dead | 🚀 Shipped | ⏳ Analyzing`, { parse_mode: 'Markdown' });
});

bot.command('scan', async (ctx) => {
  if (ctx.from?.id.toString() !== chatId) return;
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
  const repoName = (ctx.message?.text || '').replace('/repo', '').trim();
  if (!repoName) { await ctx.reply('Usage: /repo <name>'); return; }

  await ctx.reply(`⏳ Analyzing ${repoName}...`);
  await showTyping(ctx);

  try {
    const allRepos = await getGitHub().getUserRepos();
    const repo = allRepos.find(r => r.name.toLowerCase() === repoName.toLowerCase());
    if (!repo) { await ctx.reply(`❌ Repo "${repoName}" not found.`); return; }

    const [owner, name] = repo.full_name.split('/');
    const analysis = await getAnalyzer().analyzeRepo(owner, name);

    const tracked: TrackedRepo = {
      id: `${owner}/${name}`, name, owner,
      state: verdictToState(analysis.verdict),
      analysis, analyzed_at: new Date().toISOString(),
      pending_action: null, pending_since: null, last_message_id: null,
      last_push_at: repo.pushed_at, killed_at: null, shipped_at: null,
    };
    await stateManager.saveTrackedRepo(tracked);

    const msg = await ctx.reply(formatAnalysis(tracked), {
      parse_mode: 'Markdown', reply_markup: analysisKeyboard(tracked),
    });
    await stateManager.setMessageRepo(msg.message_id, owner, name);
    await stateManager.updateRepoMessageId(owner, name, msg.message_id);
  } catch (error) {
    await ctx.reply(`❌ Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
      reply_markup: new InlineKeyboard().text('🔄 Retry', `retryname:${repoName}`),
    });
  }
});

// ============ SCAN LOGIC ============

async function runScan(ctx: Context, days: number): Promise<void> {
  const startTime = Date.now();
  const TIMEOUT_MS = 55000;
  const scanId = `scan_${Date.now()}`;
  await stateManager.setActiveScan(scanId);

  try {
    const repos = await getGitHub().getRecentRepos(days);
    if (repos.length === 0) {
      await stateManager.cancelActiveScan();
      await ctx.reply(`No repos found with activity in the last ${days} days.`);
      return;
    }

    const progressMsg = await ctx.reply(formatProgress(0, repos.length, 0, 0));
    const analyzed: TrackedRepo[] = [];
    const errors: string[] = [];
    let cached = 0;
    let timedOut = false;

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
            };
          }

          if (tracked.state === 'shipped' || tracked.state === 'dead') {
            cached++; analyzed.push(tracked); return;
          }

          const hasAnalysis = tracked.analysis !== null;
          const hasNewCommits = new Date(repo.pushed_at).getTime() > (tracked.analyzed_at ? new Date(tracked.analyzed_at).getTime() : 0);
          if (hasAnalysis && !hasNewCommits) {
            cached++; analyzed.push(tracked); return;
          }

          const analysis = await getAnalyzer().analyzeRepo(owner, name);
          tracked.analysis = analysis;
          tracked.analyzed_at = new Date().toISOString();
          tracked.last_push_at = repo.pushed_at;
          tracked.state = verdictToState(analysis.verdict);
          await stateManager.saveTrackedRepo(tracked);
          analyzed.push(tracked);
        } catch (error) {
          errors.push(`${name}: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
      }));

      try {
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id,
          formatProgress(analyzed.length + errors.length, repos.length, cached, errors.length));
      } catch { /* ignore */ }
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
    let digest = formatScanDigest(groups);
    if (partial) digest = `⚠️ **Partial scan** (${analyzed.length}/${repos.length} - ${timedOut ? 'timeout' : 'incomplete'})\n\n` + digest;
    await ctx.reply(digest, { parse_mode: 'Markdown' });
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
  const [action, ...parts] = ctx.callbackQuery.data.split(':');
  await ctx.answerCallbackQuery();

  // Global actions
  if (action === 'quickscan') { await runScan(ctx, 10); return; }
  if (action === 'showstatus') {
    await ctx.reply(formatStatus(await stateManager.getRepoCounts()), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('🔍 Scan', 'quickscan').text('📋 List All', 'listall'),
    });
    return;
  }
  if (action === 'listall') {
    const all = await stateManager.getAllTrackedRepos();
    if (all.length === 0) { await ctx.reply('No repos tracked yet. Run /scan to get started.'); return; }
    const groups: GroupedRepos = {
      ship: all.filter(r => r.state === 'ready'), cut: all.filter(r => r.state === 'has_core'),
      no_core: all.filter(r => r.state === 'no_core'), dead: all.filter(r => r.state === 'dead'),
      shipped: all.filter(r => r.state === 'shipped'),
    };
    await ctx.reply(formatScanDigest(groups), { parse_mode: 'Markdown' });
    return;
  }

  // Repo-specific actions
  const [owner, name] = parts;
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
