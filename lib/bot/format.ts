// Telegram message formatters
// Principle: Scannable > Comprehensive

import { TrackedRepo, RepoState, RepoCard, ProjectStage } from '../core-types.js';

// ============ TYPES ============

export interface GroupedRepos {
  ship: TrackedRepo[];
  cut: TrackedRepo[];
  no_core: TrackedRepo[];
  dead: TrackedRepo[];
  shipped: TrackedRepo[];
}

export type CategoryKey = 'ship' | 'cut' | 'no_core' | 'dead' | 'shipped' | 'all';

// ============ CORE: Card View (Scannable) ============

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

/**
 * Minimal card view — fits on one phone screen
 * Shows: name, verdict, one-liner, next action
 */
export function formatCard(repo: TrackedRepo): string {
  const a = repo.analysis;
  if (!a) return `━━━ ${repo.name} ━━━\n❌ Analysis failed`;

  const emoji = verdictEmoji[a.verdict] || '⚪';
  const label = verdictLabel[a.verdict] || a.verdict.toUpperCase();
  
  let msg = `━━━ ${repo.name} ━━━\n`;
  msg += `${emoji} **${label}**\n\n`;
  msg += `${a.one_liner}\n`;
  
  // One line of context
  if (a.verdict_reason) {
    const reason = a.verdict_reason.length > 80 
      ? a.verdict_reason.slice(0, 77) + '...' 
      : a.verdict_reason;
    msg += `_${reason}_\n`;
  }
  
  // Next action (if cut or ship)
  if (a.verdict === 'cut_to_core' && a.cut.length > 0) {
    msg += `\n→ Delete: ${a.cut.slice(0, 3).join(', ')}`;
    if (a.cut.length > 3) msg += ` (+${a.cut.length - 3})`;
  } else if (a.verdict === 'ship' && a.tweet_draft) {
    msg += `\n→ Ready to post`;
  }

  return msg;
}

/**
 * Full details view — shown when "More" is tapped
 */
export function formatDetails(repo: TrackedRepo): string {
  const a = repo.analysis;
  if (!a) return `━━━ ${repo.name} ━━━\n❌ No analysis`;

  let msg = `━━━ ${repo.name} ━━━\n`;
  msg += `${a.one_liner}\n\n`;

  // What it does
  msg += `**WHAT IT DOES**\n${a.what_it_does}\n\n`;

  // Core value + evidence
  if (a.has_core && a.core_value) {
    msg += `**CORE VALUE**\n${a.core_value}\n`;
    if (a.core_evidence?.length) {
      a.core_evidence.slice(0, 3).forEach(ev => {
        msg += `├─ \`${ev.file}\` → ${ev.symbols.slice(0, 2).join(', ')}\n`;
      });
    }
    msg += '\n';
  }

  // Mismatch warning
  if (a.mismatch_evidence?.length) {
    const m = a.mismatch_evidence[0];
    msg += `⚠️ **README ≠ CODE**\n`;
    msg += `README says: "${m.readme_section}"\n`;
    msg += `Code shows: ${m.code_anchor}\n\n`;
  }

  // Cut list
  if (a.cut.length > 0) {
    msg += `**CUT LIST** (${a.cut.length})\n`;
    msg += a.cut.slice(0, 8).map(f => `• ${f}`).join('\n');
    if (a.cut.length > 8) msg += `\n_+${a.cut.length - 8} more_`;
    msg += '\n\n';
  }

  // Pride
  const prideEmoji: Record<string, string> = { proud: '🟢', comfortable: '🟡', neutral: '😐', embarrassed: '🔴' };
  const pride = a.pride_level || 'neutral';
  msg += `**PRIDE:** ${prideEmoji[pride] || '😐'} ${pride}\n`;
  if (a.pride_blockers?.length) {
    msg += `Blockers: ${a.pride_blockers.slice(0, 3).join(', ')}\n`;
  }

  // Tweet or shareable angle
  if (a.tweet_draft) {
    msg += `\n**TWEET**\n\`\`\`\n${a.tweet_draft}\n\`\`\``;
  } else if (a.shareable_angle) {
    msg += `\n**SHAREABLE LATER:** "${a.shareable_angle}"`;
  }

  return msg;
}

// ============ SCAN FORMATTING ============

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

export function formatProgress(done: number, total: number, cached: number, errors: number): string {
  const filled = Math.floor(done / total * 10);
  const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
  let status = `⏳ Scanning...\n\n${bar} ${done}/${total}`;
  if (cached > 0) status += `\n💨 ${cached} cached`;
  if (errors > 0) status += `\n⚠️ ${errors} errors`;
  return status;
}

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

// ============ HELPERS ============

export function stateEmoji(state: RepoState): string {
  const map: Record<RepoState, string> = {
    ready: '🟢', shipped: '🚀', has_core: '🟡', no_core: '🔴',
    dead: '☠️', analyzing: '⏳', unanalyzed: '⚪',
  };
  return map[state] || '⚪';
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

// Legacy alias for backwards compatibility
export const formatAnalysis = formatCard;

// ============ CURSOR PROMPT ============

export function formatCursorPrompt(repo: TrackedRepo): string {
  const a = repo.analysis;
  if (!a) return 'No analysis available.';

  const cutLines = a.cut.slice(0, 10).map(f => `│ - ${f}`).join('\n');
  const more = a.cut.length > 10 ? `│ ... and ${a.cut.length - 10} more` : '';

  return `┌─────────────────────────────────────────────────┐
│ Refactor ${repo.name} to its core
│                                                 
│ Goal: ${a.core_value || 'Focus on core functionality'}
│                                                 
│ Delete:                                         
${cutLines}
${more}
│                                                 
│ Keep: ${a.keep.slice(0, 3).join(', ')}
│                                                 
│ Acceptance: App loads with only the core.
└─────────────────────────────────────────────────┘`;
}

// ============ FEED CARD FORMATTING ============

export function stageLabel(stage: ProjectStage): string {
  const labels: Record<ProjectStage, string> = {
    building: '🔨 Building',
    packaging: '📦 Packaging',
    ready_to_launch: '🚀 Ready',
    post_launch: '🏆 Launched',
  };
  return labels[stage] || stage;
}

export function formatRepoCard(card: RepoCard): string {
  const lines: string[] = [];
  
  if (card.cover_image_url) {
    lines.push(`[​](${card.cover_image_url})`);
  }
  
  const vercelUrl = `https://${card.repo}.vercel.app`;
  lines.push(`**${card.repo}** ${stageLabel(card.stage)} • [live](${vercelUrl})`);
  lines.push('');
  lines.push(`_"${card.potential.potential}"_`);
  lines.push('');
  lines.push(`**LAST:** ${card.last_context.last_context}`);
  lines.push(`**NEXT:** ${card.next_step.action}`);
  
  if (card.next_step.confidence === 'high' && card.next_step.why_this_now) {
    lines.push(`_${card.next_step.why_this_now}_`);
  }
  
  if (card.next_step.blocking_question) {
    lines.push('');
    lines.push(`⚠️ ${card.next_step.blocking_question}`);
  }
  
  return lines.join('\n');
}

export function formatCompactCard(card: RepoCard, index: number): string {
  return `${index + 1}. **${card.repo}** — ${card.next_step.action}`;
}

export function formatNoMoreCards(): string {
  return `✅ **All caught up!**\n\n_Use /scan to analyze new repos._`;
}

export function formatDeepDive(
  card: RepoCard,
  deployUrl: string | null,
  additionalSteps: Array<{ label: string; action: string }>
): string {
  const lines: string[] = [];
  
  lines.push(`**${card.repo}** — Deep Dive`);
  lines.push('');
  lines.push(`**Stage:** ${stageLabel(card.stage)}`);
  if (deployUrl) lines.push(`**Live:** ${deployUrl}`);
  lines.push('');
  lines.push(`**Vision:** ${card.potential.potential}`);
  lines.push(`**For:** ${card.potential.icp}`);
  lines.push('');
  lines.push('**NEXT STEPS:**');
  lines.push(`1. ${card.next_step.action} ← _primary_`);
  additionalSteps.forEach((step, i) => {
    lines.push(`${i + 2}. ${step.action}`);
  });
  
  return lines.join('\n');
}

export function formatShipConfirm(repoName: string): string {
  return `**Ship ${repoName}?**\n\nThis marks it shipped and removes it from your feed.`;
}

export function formatShipped(repoName: string): string {
  return `🚀 **${repoName}** shipped!\n\nUse /next for your next task.`;
}

export function formatRepoCardWithArtifact(card: RepoCard): string {
  return formatRepoCard(card) + '\n\n_⚡ Artifact sent below_';
}

export function formatCompletion(
  repoName: string,
  whatChanged: string,
  liveUrl: string | null
): string {
  const lines: string[] = [];
  lines.push(`✅ **${repoName}** updated!`);
  lines.push('');
  if (liveUrl) lines.push(`**Live:** ${liveUrl}`);
  lines.push(`**What changed:** ${whatChanged}`);
  return lines.join('\n');
}

// Legacy aliases
export const formatScanDigest = formatScanSummary;
