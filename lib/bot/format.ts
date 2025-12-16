import { TrackedRepo, RepoState, RepoCard, ProjectStage } from '../core-types.js';

export interface GroupedRepos {
  ship: TrackedRepo[];
  cut: TrackedRepo[];
  no_core: TrackedRepo[];
  dead: TrackedRepo[];
  shipped: TrackedRepo[];
}

export interface RepoCounts {
  total: number;
  ready: number;
  has_core: number;
  no_core: number;
  dead: number;
  shipped: number;
  analyzing: number;
}

export function stateEmoji(state: RepoState): string {
  const map: Record<RepoState, string> = {
    ready: '🟢', shipped: '🚀', has_core: '🟡', no_core: '🔴',
    dead: '☠️', analyzing: '⏳', unanalyzed: '⚪',
  };
  return map[state] || '⚪';
}

export function formatProgress(done: number, total: number, cached: number, errors: number): string {
  const filled = Math.floor(done / total * 10);
  const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
  let status = `⏳ Scanning...\n\n${bar} ${done}/${total}`;
  if (cached > 0) status += `\n💨 ${cached} cached`;
  if (errors > 0) status += `\n⚠️ ${errors} errors`;
  return status;
}

export function formatScanSummary(groups: GroupedRepos): string {
  const total = Object.values(groups).flat().length;
  let msg = `━━━ Scan Complete ━━━\n\n`;
  
  if (groups.ship.length > 0) msg += `🚀 Ship: ${groups.ship.length}\n`;
  if (groups.cut.length > 0) msg += `✂️ Cut to Core: ${groups.cut.length}\n`;
  if (groups.no_core.length > 0) msg += `🔴 No Core: ${groups.no_core.length}\n`;
  if (groups.dead.length > 0) msg += `☠️ Dead: ${groups.dead.length}\n`;
  if (groups.shipped.length > 0) msg += `🏆 Shipped: ${groups.shipped.length}\n`;
  
  msg += `\n**${total}** repos total. Tap a category to see details.`;
  return msg;
}

export type CategoryKey = 'ship' | 'cut' | 'no_core' | 'dead' | 'shipped' | 'all';

const categoryLabels: Record<CategoryKey, string> = {
  ship: '🚀 SHIP',
  cut: '✂️ CUT TO CORE',
  no_core: '🔴 NO CORE',
  dead: '☠️ DEAD',
  shipped: '🏆 SHIPPED',
  all: '📋 ALL REPOS',
};

export function formatCategoryView(
  category: CategoryKey,
  repos: TrackedRepo[],
  page: number = 0
): { message: string; hasMore: boolean } {
  const pageSize = 5;
  const start = page * pageSize;
  const pageRepos = repos.slice(start, start + pageSize);
  const hasMore = repos.length > start + pageSize;
  
  let msg = `${categoryLabels[category]} (${repos.length})\n\n`;
  
  if (repos.length === 0) {
    msg += `_No repos in this category._`;
    return { message: msg, hasMore: false };
  }
  
  pageRepos.forEach(repo => {
    const oneLiner = repo.analysis?.one_liner || 'No description';
    const display = oneLiner.length > 80 ? oneLiner.substring(0, 77) + '...' : oneLiner;
    msg += `\`${repo.name}\`\n${display}\n\n`;
  });
  
  if (hasMore) {
    msg += `_... and ${repos.length - start - pageSize} more_`;
  }
  
  return { message: msg, hasMore };
}

// Keep old function for backwards compatibility
export function formatScanDigest(groups: GroupedRepos): string {
  const total = Object.values(groups).flat().length;
  let msg = `━━━ Scan Complete (${total} repos) ━━━\n\n`;

  const sections: [string, string, TrackedRepo[]][] = [
    ['🚀', 'SHIP', groups.ship],
    ['✂️', 'CUT TO CORE', groups.cut],
    ['🔴', 'NO CORE', groups.no_core],
    ['☠️', 'DEAD', groups.dead],
    ['🏆', 'SHIPPED', groups.shipped],
  ];

  for (const [emoji, label, repos] of sections) {
    if (repos.length > 0) {
      msg += `${emoji} **${label}** (${repos.length})\n`;
      msg += repos.map(r => `• ${r.name} — ${r.analysis?.one_liner || 'N/A'}`).join('\n');
      msg += '\n\n';
    }
  }

  msg += `_Type a repo name for full analysis._`;
  return msg;
}

export function formatStatus(counts: RepoCounts): string {
  return `📊 **Repo Status**

\`🟢 Ready\`     ${counts.ready}
\`🟡 Has Core\`  ${counts.has_core}
\`🔴 No Core\`   ${counts.no_core}
\`☠️ Dead\`      ${counts.dead}
\`🚀 Shipped\`   ${counts.shipped}
${counts.analyzing > 0 ? `\`⏳ Analyzing\` ${counts.analyzing}\n` : ''}
**Total:** ${counts.total}`;
}

export function formatAnalysis(repo: TrackedRepo, seq?: number, total?: number): string {
  const analysis = repo.analysis;
  if (!analysis) return `━━━ ${repo.name} ━━━\nAnalysis failed.`;

  const prefix = seq && total ? `[${seq}/${total}] ` : '';
  let msg = `${prefix}━━━ ${repo.name} ━━━\n`;
  msg += `${stateEmoji(repo.state)} ${analysis.one_liner}\n\n`;
  msg += `${analysis.what_it_does}\n\n`;

  if (analysis.has_core && analysis.core_value) {
    msg += `**Core:** ${analysis.core_value}\n`;
    if (analysis.why_core) msg += `**Why:** ${analysis.why_core}\n`;
  }

  if (analysis.cut.length > 0) {
    msg += `\n**Cut:** ${analysis.cut.slice(0, 5).join(', ')}`;
    if (analysis.cut.length > 5) msg += ` (+${analysis.cut.length - 5} more)`;
    msg += '\n';
  }

  msg += `\n**Verdict:** ${analysis.verdict}\n`;
  msg += `_${analysis.verdict_reason}_\n`;

  if (analysis.tweet_draft) {
    msg += `\n**Tweet:**\n\`\`\`\n${analysis.tweet_draft}\n\`\`\``;
  }

  return msg;
}

export function formatCursorPrompt(repo: TrackedRepo): string {
  const analysis = repo.analysis;
  if (!analysis) return 'No analysis available.';

  const keepList = analysis.keep.join(', ');
  const cutLines = analysis.cut.slice(0, 10).map(f => `│ - ${f}`).join('\n');
  const more = analysis.cut.length > 10 ? `│ ... and ${analysis.cut.length - 10} more` : '';

  return `┌─────────────────────────────────────────────────┐
│ Refactor ${repo.name} to its core
│                                                 
│ Goal: Focus on ${analysis.core_value || 'the core functionality'}
│                                                 
│ Delete:                                         
${cutLines}
${more}
│                                                 
│ Keep: ${keepList.substring(0, 40)}${keepList.length > 40 ? '...' : ''}
│                                                 
│ Remove all imports/references to deleted files.
│                                                 
│ Acceptance: App loads with only the core.
│ No console errors. Deploy succeeds.
└─────────────────────────────────────────────────┘`;
}

// ============ FEED CARD FORMATTING ============

function stageLabel(stage: ProjectStage): string {
  const labels: Record<ProjectStage, string> = {
    building: '🔨 Building',
    packaging: '📦 Packaging',
    ready_to_launch: '🚀 Ready',
    post_launch: '🏆 Launched',
  };
  return labels[stage] || stage;
}

function confidenceIndicator(confidence: 'high' | 'medium' | 'low'): string {
  const indicators: Record<string, string> = {
    high: '●●●',
    medium: '●●○',
    low: '●○○',
  };
  return indicators[confidence] || '○○○';
}

/**
 * Format a RepoCard for Telegram display
 * Returns the caption text (image is sent separately)
 */
export function formatRepoCard(card: RepoCard): string {
  const lines: string[] = [];
  
  // Header: Name + Stage
  lines.push(`**${card.repo}** ${stageLabel(card.stage)}`);
  lines.push('');
  
  // Potential (aspirational one-liner)
  lines.push(`_"${card.potential.potential}"_`);
  lines.push('');
  
  // Last context
  lines.push(`**LAST:** ${card.last_context.last_context}`);
  
  // Next step
  lines.push(`**NEXT:** ${card.next_step.action}`);
  
  // Why this now (if high confidence)
  if (card.next_step.confidence === 'high' && card.next_step.why_this_now) {
    lines.push(`_${card.next_step.why_this_now}_`);
  }
  
  // Blocking question (if any)
  if (card.next_step.blocking_question) {
    lines.push('');
    lines.push(`⚠️ ${card.next_step.blocking_question}`);
  }
  
  return lines.join('\n');
}

/**
 * Format a compact card for batch display (morning stack)
 */
export function formatCompactCard(card: RepoCard, index: number): string {
  return `${index + 1}. **${card.repo}** — ${card.next_step.action}`;
}

/**
 * Format the "no more cards" message
 */
export function formatNoMoreCards(): string {
  return `✅ **You've seen all your repos for today!**

Great work staying on top of things.

_Come back tomorrow for a fresh stack, or use /scan to analyze new repos._`;
}

/**
 * Format deep dive view (expanded card with multiple steps)
 */
export function formatDeepDive(
  card: RepoCard,
  deployUrl: string | null,
  additionalSteps: Array<{ label: string; action: string }>
): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`**${card.repo}** — Deep Dive`);
  lines.push('');
  
  // Status
  lines.push(`**Stage:** ${stageLabel(card.stage)}`);
  if (deployUrl) {
    lines.push(`**Live:** ${deployUrl}`);
  }
  lines.push('');
  
  // Potential
  lines.push(`**Vision:** ${card.potential.potential}`);
  lines.push(`**For:** ${card.potential.icp}`);
  lines.push(`**Promise:** ${card.potential.promise}`);
  lines.push('');
  
  // Next steps
  lines.push('**NEXT STEPS:**');
  lines.push(`1. ${card.next_step.action} ← _primary_`);
  additionalSteps.forEach((step, i) => {
    lines.push(`${i + 2}. ${step.action}`);
  });
  
  return lines.join('\n');
}

/**
 * Format completion message after push
 */
export function formatCompletion(
  repoName: string,
  whatChanged: string,
  liveUrl: string | null
): string {
  const lines: string[] = [];
  
  lines.push(`✅ **${repoName}** updated!`);
  lines.push('');
  
  if (liveUrl) {
    lines.push(`**Live:** ${liveUrl}`);
  }
  
  lines.push(`**What changed:** ${whatChanged}`);
  
  return lines.join('\n');
}
