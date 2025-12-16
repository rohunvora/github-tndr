import type { Context } from 'grammy';
import { RepoAnalyzer } from '../analyzer.js';
import { stateManager } from '../state.js';
import { TrackedRepo, RepoState, Verdict } from '../core-types.js';
import { formatAnalysis } from './format.js';
import { analysisKeyboard } from './keyboards.js';

export function verdictToState(verdict: Verdict): RepoState {
  const map: Record<Verdict, RepoState> = {
    ship: 'ready',
    cut_to_core: 'has_core',
    no_core: 'no_core',
    dead: 'dead',
  };
  return map[verdict];
}

export interface ReanalyzeOptions {
  clearKilled?: boolean;    // for revive
  clearPending?: boolean;   // for reanalyze after action
}

export async function reanalyzeRepo(
  ctx: Context,
  repo: TrackedRepo,
  analyzer: RepoAnalyzer,
  label: string,
  options: ReanalyzeOptions = {}
): Promise<void> {
  await ctx.api.sendChatAction(ctx.chat!.id, 'typing');
  await ctx.reply(`⏳ ${label} ${repo.name}...`);

  try {
    const analysis = await analyzer.analyzeRepo(repo.owner, repo.name);
    
    repo.analysis = analysis;
    repo.state = verdictToState(analysis.verdict);
    repo.analyzed_at = new Date().toISOString();
    
    if (options.clearKilled) repo.killed_at = null;
    if (options.clearPending) {
      repo.pending_action = null;
      repo.pending_since = null;
    }
    
    await stateManager.saveTrackedRepo(repo);

    const msg = await ctx.reply(formatAnalysis(repo), {
      parse_mode: 'Markdown',
      reply_markup: analysisKeyboard(repo),
    });
    await stateManager.setMessageRepo(msg.message_id, repo.owner, repo.name);
  } catch (error) {
    await ctx.reply(`❌ ${label} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
