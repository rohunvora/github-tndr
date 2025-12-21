/**
 * Scan Tool Handler
 * Batch analyze all repos
 */

import type { Context } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { stateManager } from '../../core/state.js';
import { GitHubClient } from '../../core/github.js';
import { scanSkill } from '../../skills/scan/index.js';
import {
  formatScanProgress,
  formatScanSummary,
  formatScanTimeout,
  summaryKeyboard,
  type ScanVerdictCounts,
  type GroupedRepos,
} from './format.js';
import { acquireLock, releaseLock } from '../../core/update-guard.js';

// GitHub singleton
let github: GitHubClient | null = null;

function getGitHub(): GitHubClient {
  if (!github) {
    github = new GitHubClient(process.env.GITHUB_TOKEN!);
  }
  return github;
}

/**
 * Handle /scan command
 */
export async function handleScanCommand(ctx: Context, args: string): Promise<void> {
  info('scan', '/scan', { args });
  
  // Layer 2: Command-level lock prevents concurrent scans (in addition to activeScan check)
  // This catches Telegram retries before they can even check activeScan state
  const lockKey = `scan:${ctx.chat!.id}`;
  if (!await acquireLock(lockKey, 120)) {  // 2 min TTL
    await ctx.reply('⏳ Scan already running...');
    return;
  }
  
  try {
    const activeScan = await stateManager.getActiveScan();
    if (activeScan) {
      await ctx.reply('⏳ Scan already running. Use `/cancel` to stop.', { parse_mode: 'Markdown' });
      return;
    }
    
    const daysMatch = args.match(/(\d+)/);
    const days = daysMatch ? parseInt(daysMatch[1], 10) : 10;
    
    await runScan(ctx, days);
  } finally {
    // Always release lock when done (success or error)
    await releaseLock(lockKey);
  }
}

/**
 * Handle /cancel command
 */
export async function handleCancelCommand(ctx: Context): Promise<void> {
  await stateManager.cancelActiveScan();
  await ctx.reply('✅ Scan cancelled.');
}

/**
 * Handle /status command
 */
export async function handleStatusCommand(ctx: Context): Promise<void> {
  const counts = await stateManager.getRepoCounts();
  const msg = `📊 **Status**

🟢 Ready: ${counts.ready}
🟡 Has Core: ${counts.has_core}
🔴 No Core: ${counts.no_core}
☠️ Dead: ${counts.dead}
🚀 Shipped: ${counts.shipped}

Total: ${counts.total}`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
}

/**
 * Run the scan using scanSkill
 */
async function runScan(ctx: Context, days: number): Promise<void> {
  const scanId = `scan_${Date.now()}`;
  info('scan', 'Starting', { days, scanId });
  await stateManager.setActiveScan(scanId);

  let progressMsg: { message_id: number } | null = null;
  let lastUpdate = 0;
  let currentRepo: string | null = null;
  let totalRepos = 0;
  let analyzedCount = 0;
  const verdicts: ScanVerdictCounts = { ship: 0, cut: 0, no_core: 0, dead: 0, shipped: 0 };

  const updateProgress = async () => {
    if (!progressMsg) return;
    if (Date.now() - lastUpdate < 500) return;
    lastUpdate = Date.now();
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        formatScanProgress(analyzedCount, totalRepos, currentRepo, verdicts, 0),
        { parse_mode: 'Markdown' }
      );
    } catch { /* rate limit */ }
  };

  try {
    progressMsg = await ctx.reply('🔍 Fetching repos...');

    // Run scan via skill
    const result = await scanSkill.run({
      days,
      timeout: 55000,
      onRepoAnalyzed: async (repo, index, total) => {
        totalRepos = total;
        analyzedCount = index;
        currentRepo = repo.name;

        // Update verdict counts
        if (repo.state === 'shipped') verdicts.shipped++;
        else if (repo.analysis?.verdict === 'ship') verdicts.ship++;
        else if (repo.analysis?.verdict === 'cut_to_core') verdicts.cut++;
        else if (repo.analysis?.verdict === 'no_core') verdicts.no_core++;
        else if (repo.analysis?.verdict === 'dead') verdicts.dead++;

        await updateProgress();
      },
    }, {
      github: getGitHub(),
      anthropic: {} as never,
      gemini: {} as never,
      kv: {} as never,
      telegram: {} as never,
      sessions: {} as never,
      onProgress: async (step, detail) => {
        if (!progressMsg) return;
        if (step === 'Fetching repos...') {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            progressMsg.message_id,
            '🔍 Fetching repos...',
            { parse_mode: 'Markdown' }
          );
        }
      },
    });

    if (!result.success) {
      throw new Error(result.error || 'Scan failed');
    }

    const { groups, errors, hitTimeout, totalFound, totalAnalyzed, summaryMessage } = result.data!;

    // Show timeout or delete progress
    if (hitTimeout && totalAnalyzed < totalFound) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        formatScanTimeout(totalAnalyzed, totalFound, verdicts),
        { parse_mode: 'Markdown' }
      );
    } else {
      try { await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id); } catch { /* ok */ }
    }

    info('scan', 'Complete', { analyzed: totalAnalyzed, errors: errors.length, hitTimeout });
    await ctx.reply(formatScanSummary(groups), { parse_mode: 'Markdown', reply_markup: summaryKeyboard(groups) });
    await stateManager.cancelActiveScan();

    if (errors.length > 0) {
      await ctx.reply(`⚠️ ${errors.length} failed:\n${errors.slice(0, 3).join('\n')}`);
    }
  } catch (err) {
    logErr('scan', err);
    await stateManager.cancelActiveScan();
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    const timestamp = new Date().toISOString();
    await ctx.reply(
      `❌ **/scan** failed\n\n` +
      `**Error:** \`${errorMsg}\`\n` +
      `**Time:** ${timestamp}\n\n` +
      `_Copy this message to debug_`,
      { parse_mode: 'Markdown' }
    );
  }
}

