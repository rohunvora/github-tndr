/**
 * Scan Tool Handler
 * Batch analyze all repos
 */

import type { Context } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { stateManager } from '../../core/state.js';
import { GitHubClient } from '../../core/github.js';
import type { TrackedRepo } from '../../core/types.js';
import { getRepoAnalyzer } from '../repo/analyzer.js';
import { verdictToState } from '../repo/format.js';
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
 * Run the scan
 */
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

    const analyzed: TrackedRepo[] = [];
    const errors: string[] = [];
    let cached = 0;
    let lastUpdate = 0;
    let currentRepo: string | null = null;

    const verdicts: ScanVerdictCounts = { ship: 0, cut: 0, no_core: 0, dead: 0, shipped: 0 };

    const countVerdict = (repo: TrackedRepo) => {
      if (repo.state === 'shipped') verdicts.shipped++;
      else if (repo.analysis?.verdict === 'ship') verdicts.ship++;
      else if (repo.analysis?.verdict === 'cut_to_core') verdicts.cut++;
      else if (repo.analysis?.verdict === 'no_core') verdicts.no_core++;
      else if (repo.analysis?.verdict === 'dead') verdicts.dead++;
    };

    const updateProgress = async (force = false) => {
      if (!force && Date.now() - lastUpdate < 500) return;
      lastUpdate = Date.now();
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          progressMsg.message_id,
          formatScanProgress(analyzed.length + errors.length, repos.length, currentRepo, verdicts, cached),
          { parse_mode: 'Markdown' }
        );
      } catch { /* rate limit */ }
    };

    // Initial progress
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMsg.message_id,
      formatScanProgress(0, repos.length, null, verdicts, 0),
      { parse_mode: 'Markdown' }
    );

    let hitTimeout = false;
    for (let i = 0; i < repos.length; i += 5) {
      if (Date.now() - startTime > TIMEOUT) {
        hitTimeout = true;
        break;
      }
      if (await stateManager.getActiveScan() !== scanId) {
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '⏹️ Cancelled.');
        return;
      }

      await Promise.all(repos.slice(i, i + 5).map(async (repo) => {
        const [owner, name] = repo.full_name.split('/');
        currentRepo = name;
        await updateProgress();

        try {
          let tracked = await stateManager.getTrackedRepo(owner, name);

          // Skip shipped/dead
          if (tracked?.state === 'shipped' || tracked?.state === 'dead') {
            cached++;
            countVerdict(tracked);
            analyzed.push(tracked);
            await updateProgress();
            return;
          }

          // Skip if no new commits
          const hasAnalysis = tracked?.analysis !== null;
          const hasNewCommits = new Date(repo.pushed_at).getTime() > (tracked?.analyzed_at ? new Date(tracked.analyzed_at).getTime() : 0);
          if (hasAnalysis && !hasNewCommits && tracked) {
            cached++;
            countVerdict(tracked);
            analyzed.push(tracked);
            await updateProgress();
            return;
          }

          // Analyze
          const analysis = await getRepoAnalyzer().analyzeRepo(owner, name);
          tracked = {
            id: `${owner}/${name}`, name, owner,
            state: verdictToState(analysis.verdict),
            analysis, analyzed_at: new Date().toISOString(),
            pending_action: null, pending_since: null, last_message_id: null,
            last_push_at: repo.pushed_at, killed_at: null, shipped_at: null,
            cover_image_url: tracked?.cover_image_url || null,
            homepage: repo.homepage || null,
          };
          await stateManager.saveTrackedRepo(tracked);
          countVerdict(tracked);
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

    // Show timeout or delete progress
    if (hitTimeout && analyzed.length < repos.length) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        formatScanTimeout(analyzed.length, repos.length, verdicts),
        { parse_mode: 'Markdown' }
      );
    } else {
      try { await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id); } catch { /* ok */ }
    }

    const groups: GroupedRepos = {
      ship: analyzed.filter(r => r.analysis?.verdict === 'ship'),
      cut: analyzed.filter(r => r.analysis?.verdict === 'cut_to_core'),
      no_core: analyzed.filter(r => r.analysis?.verdict === 'no_core'),
      dead: analyzed.filter(r => r.analysis?.verdict === 'dead'),
      shipped: analyzed.filter(r => r.state === 'shipped'),
    };

    info('scan', 'Complete', { analyzed: analyzed.length, errors: errors.length, hitTimeout });
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

