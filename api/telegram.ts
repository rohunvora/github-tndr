export const config = {
  runtime: 'edge',
  maxDuration: 60, // Allow longer execution for scans
};

import { Bot, InlineKeyboard } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { RepoAnalyzer } from '../lib/analyzer.js';
import { stateManager } from '../lib/state.js';
import { GitHubClient } from '../lib/github.js';
import { TrackedRepo, CoreAnalysis, RepoState } from '../lib/core-types.js';

// ============ BOT SETUP ============

function getBotInfo(token: string): UserFromGetMe {
  const botId = parseInt(token.split(':')[0], 10);
  return {
    id: botId,
    is_bot: true,
    first_name: 'ShipBot',
    username: 'ship_or_kill_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  };
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!, {
  botInfo: getBotInfo(process.env.TELEGRAM_BOT_TOKEN!),
});

const chatId = process.env.USER_TELEGRAM_CHAT_ID!.trim();

// Initialize clients lazily
let analyzer: RepoAnalyzer | null = null;
let github: GitHubClient | null = null;

function getAnalyzer(): RepoAnalyzer {
  if (!analyzer) {
    analyzer = new RepoAnalyzer(
      process.env.ANTHROPIC_API_KEY!,
      process.env.GITHUB_TOKEN!
    );
  }
  return analyzer;
}

function getGitHub(): GitHubClient {
  if (!github) {
    github = new GitHubClient(process.env.GITHUB_TOKEN!);
  }
  return github;
}

// ============ MESSAGE FORMATTING ============

function formatAnalysisMessage(
  repo: TrackedRepo,
  sequenceNum?: number,
  totalRepos?: number
): string {
  const analysis = repo.analysis;
  if (!analysis) {
    return `━━━ ${repo.name} ━━━\nAnalysis failed.`;
  }

  const seqPrefix = sequenceNum && totalRepos ? `[${sequenceNum}/${totalRepos}] ` : '';
  const stateEmoji = getStateEmoji(repo.state);

  let msg = `${seqPrefix}━━━ ${repo.name} ━━━\n`;
  msg += `${stateEmoji} ${analysis.one_liner}\n\n`;
  msg += `${analysis.what_it_does}\n\n`;

  if (analysis.has_core && analysis.core_value) {
    msg += `**Core:** ${analysis.core_value}\n`;
    if (analysis.why_core) {
      msg += `**Why:** ${analysis.why_core}\n`;
    }
  }

  if (analysis.cut.length > 0) {
    msg += `\n**Cut:** ${analysis.cut.slice(0, 5).join(', ')}`;
    if (analysis.cut.length > 5) {
      msg += ` (+${analysis.cut.length - 5} more)`;
    }
    msg += '\n';
  }

  msg += `\n**Verdict:** ${analysis.verdict}\n`;
  msg += `_${analysis.verdict_reason}_\n`;

  if (analysis.tweet_draft) {
    msg += `\n**Tweet:**\n\`\`\`\n${analysis.tweet_draft}\n\`\`\``;
  }

  return msg;
}

function getStateEmoji(state: RepoState): string {
  switch (state) {
    case 'ready': return '🟢';
    case 'shipped': return '🚀';
    case 'has_core': return '🟡';
    case 'no_core': return '🔴';
    case 'dead': return '☠️';
    case 'analyzing': return '⏳';
    default: return '⚪';
  }
}

function createAnalysisKeyboard(repo: TrackedRepo): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const repoId = `${repo.owner}:${repo.name}`;
  const analysis = repo.analysis;

  if (!analysis) {
    keyboard.text('🔄 Retry', `retry:${repoId}`);
    return keyboard;
  }

  switch (analysis.verdict) {
    case 'ship':
      keyboard.text('🚀 Post this', `ship:${repoId}`);
      keyboard.text('✏️ Edit tweet', `edit:${repoId}`);
      keyboard.row();
      keyboard.text('⏸️ Not yet', `skip:${repoId}`);
      break;

    case 'cut_to_core':
      keyboard.text('✂️ Cut to core', `cut:${repoId}`);
      keyboard.text('🚀 Ship as-is', `ship:${repoId}`);
      keyboard.row();
      keyboard.text('☠️ Kill', `kill:${repoId}`);
      break;

    case 'no_core':
      keyboard.text('🔍 Dig deeper', `deeper:${repoId}`);
      keyboard.text('☠️ Kill', `kill:${repoId}`);
      break;

    case 'dead':
      keyboard.text('☠️ Kill', `kill:${repoId}`);
      keyboard.text('🔄 Revive', `revive:${repoId}`);
      break;
  }

  return keyboard;
}

function formatCursorPrompt(repo: TrackedRepo): string {
  const analysis = repo.analysis;
  if (!analysis) return 'No analysis available.';

  const deleteList = analysis.cut.map(f => `- ${f}`).join('\n');
  const keepList = analysis.keep.join(', ');

  return `┌─────────────────────────────────────────────────┐
│ Refactor ${repo.name} to its core
│                                                 
│ Goal: Focus on ${analysis.core_value || 'the core functionality'}
│                                                 
│ Delete:                                         
${analysis.cut.slice(0, 10).map(f => `│ - ${f}`).join('\n')}
${analysis.cut.length > 10 ? `│ ... and ${analysis.cut.length - 10} more` : ''}
│                                                 
│ Keep: ${keepList.substring(0, 40)}${keepList.length > 40 ? '...' : ''}
│                                                 
│ Remove all imports/references to deleted files.
│                                                 
│ Acceptance: App loads with only the core.
│ No console errors. Deploy succeeds.
└─────────────────────────────────────────────────┘`;
}

// ============ COMMANDS ============

bot.command('start', async (ctx) => {
  await ctx.reply(`👋 Ship or Kill Bot

I help you blast through your repos and decide: ship it, cut to core, or kill it.

**Commands:**
/scan - Analyze repos from last 10 days
/scan 30 - Analyze repos from last 30 days
/status - See counts by state
/repo <name> - Deep dive on one repo

Reply to any analysis message to continue that thread.`);
});

bot.command('scan', async (ctx) => {
  const userId = ctx.from?.id.toString();
  if (userId !== chatId) return;

  // Parse days from command
  const text = ctx.message?.text || '';
  const daysMatch = text.match(/\/scan\s+(\d+)/);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : 10;

  await ctx.reply(`⏳ Scanning repos from last ${days} days...`);

  try {
    const gh = getGitHub();
    const repos = await gh.getRecentRepos(days);

    if (repos.length === 0) {
      await ctx.reply(`No repos found with activity in the last ${days} days.`);
      return;
    }

    await ctx.reply(`Found ${repos.length} repos. Analyzing...`);

    const scanId = `scan_${Date.now()}`;
    const results = {
      total: repos.length,
      analyzed: 0,
      ready: 0,
      cut_to_core: 0,
      no_core: 0,
      dead: 0,
      shipped: 0,
    };

    // Process repos in parallel (batches of 5 to avoid rate limits)
    const batchSize = 5;
    for (let i = 0; i < repos.length; i += batchSize) {
      const batch = repos.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (repo, batchIndex) => {
          const seqNum = i + batchIndex + 1;
          const [owner, name] = repo.full_name.split('/');

          try {
            // Check if already tracked
            let tracked = await stateManager.getTrackedRepo(owner, name);

            // Check if this is rev-agg (shipped)
            const isShipped = name === 'rev-agg';

            if (!tracked) {
              // Create new tracked repo
              tracked = {
                id: `${owner}/${name}`,
                name,
                owner,
                state: isShipped ? 'shipped' : 'analyzing',
                analysis: null,
                analyzed_at: null,
                pending_action: null,
                pending_since: null,
                last_message_id: null,
                last_push_at: repo.pushed_at,
                killed_at: null,
                shipped_at: isShipped ? new Date().toISOString() : null,
              };
            }

            // Skip analysis for shipped repos
            if (isShipped) {
              tracked.state = 'shipped';
              await stateManager.saveTrackedRepo(tracked);
              results.shipped++;
              results.analyzed++;

              const msg = await ctx.reply(
                `[${seqNum}/${repos.length}] ━━━ ${name} ━━━\n🚀 Already shipped!\n\nThis is your launched project.`,
                { reply_markup: new InlineKeyboard().text('📊 View stats', `stats:${owner}:${name}`) }
              );
              await stateManager.setMessageRepo(msg.message_id, owner, name);
              return;
            }

            // Analyze the repo
            const analyzerInstance = getAnalyzer();
            const analysis = await analyzerInstance.analyzeRepo(owner, name);

            // Update tracked repo
            tracked.analysis = analysis;
            tracked.analyzed_at = new Date().toISOString();
            tracked.state = verdictToState(analysis.verdict);

            await stateManager.saveTrackedRepo(tracked);

            // Update results
            results.analyzed++;
            if (analysis.verdict === 'ship') results.ready++;
            else if (analysis.verdict === 'cut_to_core') results.cut_to_core++;
            else if (analysis.verdict === 'no_core') results.no_core++;
            else if (analysis.verdict === 'dead') results.dead++;

            // Send result message
            const message = formatAnalysisMessage(tracked, seqNum, repos.length);
            const keyboard = createAnalysisKeyboard(tracked);

            const msg = await ctx.reply(message, {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            });

            // Store message -> repo mapping for reply-to
            await stateManager.setMessageRepo(msg.message_id, owner, name);
            await stateManager.updateRepoMessageId(owner, name, msg.message_id);
          } catch (error) {
            console.error(`Failed to analyze ${repo.full_name}:`, error);
            results.analyzed++;

            await ctx.reply(
              `[${seqNum}/${repos.length}] ━━━ ${name} ━━━\n❌ Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        })
      );

      // Small delay between batches
      if (i + batchSize < repos.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Save scan results
    await stateManager.saveScanResult(scanId, results);

    // Send summary
    await ctx.reply(
      `✅ **Scan complete**

${results.ready} ready to ship
${results.cut_to_core} need focus (cut to core)
${results.no_core} unclear (no core found)
${results.dead} dead
${results.shipped} already shipped

Total: ${results.analyzed}/${results.total} analyzed`
    );
  } catch (error) {
    console.error('Scan error:', error);
    await ctx.reply(`❌ Scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

bot.command('status', async (ctx) => {
  const userId = ctx.from?.id.toString();
  if (userId !== chatId) return;

  try {
    const counts = await stateManager.getRepoCounts();

    await ctx.reply(
      `📊 **Repo Status**

🟢 Ready to ship: ${counts.ready}
🟡 Has core (needs work): ${counts.has_core}
🔴 No core found: ${counts.no_core}
☠️ Dead: ${counts.dead}
🚀 Shipped: ${counts.shipped}
⏳ Analyzing: ${counts.analyzing}

Total tracked: ${counts.total}`
    );
  } catch (error) {
    console.error('Status error:', error);
    await ctx.reply('❌ Failed to get status.');
  }
});

bot.command('repo', async (ctx) => {
  const userId = ctx.from?.id.toString();
  if (userId !== chatId) return;

  const text = ctx.message?.text || '';
  const repoName = text.replace('/repo', '').trim();

  if (!repoName) {
    await ctx.reply('Usage: /repo <name>');
    return;
  }

  await ctx.reply(`⏳ Analyzing ${repoName}...`);

  try {
    const gh = getGitHub();
    const allRepos = await gh.getUserRepos();
    const repo = allRepos.find(r => r.name.toLowerCase() === repoName.toLowerCase());

    if (!repo) {
      await ctx.reply(`❌ Repo "${repoName}" not found.`);
      return;
    }

    const [owner, name] = repo.full_name.split('/');
    const analyzerInstance = getAnalyzer();
    const analysis = await analyzerInstance.analyzeRepo(owner, name);

    // Create/update tracked repo
    const tracked: TrackedRepo = {
      id: `${owner}/${name}`,
      name,
      owner,
      state: verdictToState(analysis.verdict),
      analysis,
      analyzed_at: new Date().toISOString(),
      pending_action: null,
      pending_since: null,
      last_message_id: null,
      last_push_at: repo.pushed_at,
      killed_at: null,
      shipped_at: null,
    };

    await stateManager.saveTrackedRepo(tracked);

    // Send result
    const message = formatAnalysisMessage(tracked);
    const keyboard = createAnalysisKeyboard(tracked);

    const msg = await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await stateManager.setMessageRepo(msg.message_id, owner, name);
    await stateManager.updateRepoMessageId(owner, name, msg.message_id);
  } catch (error) {
    console.error('Repo analysis error:', error);
    await ctx.reply(`❌ Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// ============ BUTTON HANDLERS ============

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, owner, name] = data.split(':');

  await ctx.answerCallbackQuery();

  const repo = await stateManager.getTrackedRepo(owner, name);
  if (!repo) {
    await ctx.reply(`Repo ${owner}/${name} not found.`);
    return;
  }

  switch (action) {
    case 'kill': {
      await stateManager.updateRepoState(owner, name, 'dead');
      await ctx.reply(`☠️ **${name}** killed. Off your plate.`);
      break;
    }

    case 'ship': {
      if (repo.analysis?.tweet_draft) {
        await ctx.reply(
          `🚀 **${name}** ready to ship!\n\n**Tweet:**\n\`\`\`\n${repo.analysis.tweet_draft}\n\`\`\`\n\nCopy and post. Reply "shipped" when done.`
        );
      } else {
        await ctx.reply(`🚀 **${name}** marked ready. Generate a tweet with /repo ${name}`);
      }
      await stateManager.updateRepoState(owner, name, 'ready');
      break;
    }

    case 'cut': {
      const prompt = formatCursorPrompt(repo);
      await ctx.reply(
        `✂️ **Cut to core for ${name}**\n\nPaste this into Cursor:\n\n\`\`\`\n${prompt}\n\`\`\`\n\nReply "done" when you've pushed the changes.`
      );
      await stateManager.setPendingAction(owner, name, 'cut_to_core');
      break;
    }

    case 'skip': {
      await ctx.reply(`⏸️ **${name}** skipped for now.`);
      break;
    }

    case 'deeper': {
      await ctx.reply(`⏳ Re-analyzing ${name} in depth...`);
      try {
        const analyzerInstance = getAnalyzer();
        const analysis = await analyzerInstance.analyzeRepo(owner, name);
        repo.analysis = analysis;
        repo.state = verdictToState(analysis.verdict);
        repo.analyzed_at = new Date().toISOString();
        await stateManager.saveTrackedRepo(repo);

        const message = formatAnalysisMessage(repo);
        const keyboard = createAnalysisKeyboard(repo);
        const msg = await ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        await stateManager.setMessageRepo(msg.message_id, owner, name);
      } catch (error) {
        await ctx.reply(`❌ Re-analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      break;
    }

    case 'revive': {
      await ctx.reply(`⏳ Reviving ${name}...`);
      try {
        const analyzerInstance = getAnalyzer();
        const analysis = await analyzerInstance.analyzeRepo(owner, name);
        repo.analysis = analysis;
        repo.state = verdictToState(analysis.verdict);
        repo.analyzed_at = new Date().toISOString();
        repo.killed_at = null;
        await stateManager.saveTrackedRepo(repo);

        const message = formatAnalysisMessage(repo);
        const keyboard = createAnalysisKeyboard(repo);
        const msg = await ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        await stateManager.setMessageRepo(msg.message_id, owner, name);
      } catch (error) {
        await ctx.reply(`❌ Revival failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      break;
    }

    case 'edit': {
      await ctx.reply(`✏️ What tone do you want for the tweet? (casual, professional, technical, hype)`);
      // TODO: Implement tweet editing flow
      break;
    }

    case 'retry': {
      await ctx.reply(`⏳ Retrying analysis for ${name}...`);
      try {
        const analyzerInstance = getAnalyzer();
        const analysis = await analyzerInstance.analyzeRepo(owner, name);
        repo.analysis = analysis;
        repo.state = verdictToState(analysis.verdict);
        repo.analyzed_at = new Date().toISOString();
        await stateManager.saveTrackedRepo(repo);

        const message = formatAnalysisMessage(repo);
        const keyboard = createAnalysisKeyboard(repo);
        const msg = await ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        await stateManager.setMessageRepo(msg.message_id, owner, name);
      } catch (error) {
        await ctx.reply(`❌ Retry failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      break;
    }
  }
});

// ============ TEXT MESSAGE HANDLER (for reply-to and natural language) ============

bot.on('message:text', async (ctx) => {
  const userMessage = ctx.message.text;
  const userId = ctx.from?.id.toString();

  if (userId !== chatId) return;
  if (userMessage.startsWith('/')) return;

  // Check if this is a reply to a previous message
  const replyTo = ctx.message.reply_to_message;
  let targetRepo: TrackedRepo | null = null;

  if (replyTo) {
    // Get repo from reply-to message
    const repoRef = await stateManager.getMessageRepo(replyTo.message_id);
    if (repoRef) {
      targetRepo = await stateManager.getTrackedRepo(repoRef.owner, repoRef.name);
    }
  }

  // Natural language triggers
  const lower = userMessage.toLowerCase().trim();

  // "done" / "pushed" / "fixed" - check pending action
  if (['done', 'pushed', 'fixed', 'finished'].some(w => lower.includes(w))) {
    if (targetRepo && targetRepo.pending_action) {
      await ctx.reply(`⏳ Checking ${targetRepo.name}...`);

      try {
        const analyzerInstance = getAnalyzer();
        const analysis = await analyzerInstance.analyzeRepo(targetRepo.owner, targetRepo.name);
        targetRepo.analysis = analysis;
        targetRepo.state = verdictToState(analysis.verdict);
        targetRepo.analyzed_at = new Date().toISOString();
        targetRepo.pending_action = null;
        targetRepo.pending_since = null;
        await stateManager.saveTrackedRepo(targetRepo);

        const message = formatAnalysisMessage(targetRepo);
        const keyboard = createAnalysisKeyboard(targetRepo);
        const msg = await ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        await stateManager.setMessageRepo(msg.message_id, targetRepo.owner, targetRepo.name);
      } catch (error) {
        await ctx.reply(`❌ Check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      return;
    } else {
      await ctx.reply(`What repo are you done with? Reply to the analysis message or use /repo <name>`);
      return;
    }
  }

  // "kill" / "dead" - mark as dead
  if (['kill', 'kill it', 'dead', 'delete'].some(w => lower === w || lower.startsWith(w + ' '))) {
    if (targetRepo) {
      await stateManager.updateRepoState(targetRepo.owner, targetRepo.name, 'dead');
      await ctx.reply(`☠️ **${targetRepo.name}** killed. Off your plate.`);
      return;
    }
  }

  // "ship" / "shipped" / "posted" - mark as shipped
  if (['ship', 'shipped', 'posted', 'launched'].some(w => lower === w || lower.startsWith(w + ' '))) {
    if (targetRepo) {
      await stateManager.updateRepoState(targetRepo.owner, targetRepo.name, 'shipped');
      await ctx.reply(`🚀 **${targetRepo.name}** shipped! Nice work.\n\nHow'd it go? Any feedback?`);
      return;
    }
  }

  // Post-launch feedback pattern: "got X likes" or "people want Y"
  const tractionMatch = userMessage.match(/(\d+)\s*(likes?|stars?|users?|signups?)/i);
  const featureMatch = userMessage.match(/(?:people|they|users?)\s+(?:want|asking for|need)\s+(.+)/i);

  if (targetRepo && (tractionMatch || featureMatch)) {
    let response = `📊 **${targetRepo.name}** feedback noted.\n\n`;

    if (tractionMatch) {
      response += `**Traction:** ${tractionMatch[1]} ${tractionMatch[2]} - solid signal!\n`;
    }

    if (featureMatch) {
      const feature = featureMatch[1].trim();
      response += `**Feature request:** ${feature}\n\nWant a Cursor prompt to add this?`;
    }

    await ctx.reply(response);
    return;
  }

  // Default: help message
  if (!targetRepo) {
    await ctx.reply(
      `Not sure which repo you're talking about.\n\nReply to an analysis message, or use:\n- /scan - Analyze recent repos\n- /status - See repo counts\n- /repo <name> - Analyze specific repo`
    );
  }
});

// ============ HELPER FUNCTIONS ============

function verdictToState(verdict: string): RepoState {
  switch (verdict) {
    case 'ship': return 'ready';
    case 'cut_to_core': return 'has_core';
    case 'no_core': return 'no_core';
    case 'dead': return 'dead';
    default: return 'no_core';
  }
}

// ============ WEBHOOK HANDLER ============

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const update = await req.json() as Update;

    const debugInfo = {
      updateType: update.message ? 'message' : update.callback_query ? 'callback' : 'other',
      fromId: update.message?.from?.id || update.callback_query?.from?.id,
      expectedChatId: chatId,
      text: update.message?.text?.substring(0, 50) || update.callback_query?.data,
    };
    console.log('Telegram update:', JSON.stringify(debugInfo));

    await bot.handleUpdate(update);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
