// Telegram message formatters
// Principle: Scannable > Comprehensive

import { TrackedRepo, RepoState, RepoCard, ProjectStage } from '../core-types.js';
import { CardProgress } from '../card-generator.js';

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

const prideEmoji: Record<string, string> = {
  proud: '🟢',
  comfortable: '🟡',
  neutral: '😐',
  embarrassed: '🔴',
};

/**
 * Minimal card view — fits on one phone screen
 * Shows: verdict + code-core + mismatch flag + next action + pride
 * Uses code_one_liner (code-derived) not one_liner (README-ish)
 */
export function formatCard(repo: TrackedRepo): string {
  const a = repo.analysis;
  if (!a) return `━━━ ${repo.name} ━━━\n❌ Analysis failed`;

  const emoji = verdictEmoji[a.verdict] || '⚪';
  const label = verdictLabel[a.verdict] || a.verdict.toUpperCase();
  
  // Use code_one_liner if available, fallback to one_liner
  const codeLine = a.code_one_liner || a.one_liner;
  
  let msg = `━━━ ${repo.name} ━━━\n`;
  msg += `${emoji} **${label}**\n\n`;
  msg += `${codeLine}\n`;
  
  // Mismatch flag (brief, on card)
  if (a.mismatch_evidence?.length) {
    const m = a.mismatch_evidence[0];
    const short = m.conflict.length > 40 ? m.conflict.slice(0, 37) + '...' : m.conflict;
    msg += `⚠️ README ≠ code: ${short}\n`;
  }
  
  // Next action
  if (a.verdict === 'cut_to_core' && a.cut.length > 0) {
    msg += `\n→ Delete: ${a.cut.slice(0, 3).join(', ')}`;
    if (a.cut.length > 3) msg += ` (+${a.cut.length - 3})`;
    msg += '\n';
  } else if (a.verdict === 'ship' && a.tweet_draft) {
    msg += `\n→ Ready to post\n`;
  } else if (a.verdict === 'no_core') {
    msg += `\n→ Find or create the core\n`;
}

  // Pride with blocker count
  const pride = a.pride_level || 'neutral';
  const blockerCount = a.pride_blockers?.length || 0;
  msg += `\nPride: ${prideEmoji[pride] || '😐'} ${pride}`;
  if (blockerCount > 0) msg += ` (${blockerCount} blocker${blockerCount > 1 ? 's' : ''})`;

  return msg;
}

/**
 * Full details view — shown when "More" is tapped
 * DIFFERENT content from card view: evidence, proof, full cut list, shareable
 * Does NOT repeat card content
 */
export function formatDetails(repo: TrackedRepo): string {
  const a = repo.analysis;
  if (!a) return `━━━ ${repo.name} ━━━\n❌ No analysis`;

  let msg = `📋 **${repo.name}** — Details\n\n`;

  // Core evidence (not shown on card)
  if (a.has_core && a.core_value) {
    msg += `**CORE:** ${a.core_value}\n`;
    if (a.core_evidence?.length) {
      msg += `**Evidence:**\n`;
      a.core_evidence.slice(0, 4).forEach(ev => {
        msg += `• \`${ev.file}\` → ${ev.symbols.join(', ')}\n`;
        if (ev.reason) msg += `  _${ev.reason}_\n`;
      });
    }
    msg += '\n';
  }

  // README claims proof (not shown on card)
  if (a.readme_claims?.length) {
    msg += `**README CLAIMS:**\n`;
    a.readme_claims.slice(0, 3).forEach(claim => {
      const icon = claim.support === 'supported' ? '✓' : claim.support === 'partial' ? '~' : '✗';
      msg += `${icon} "${claim.claim.slice(0, 50)}${claim.claim.length > 50 ? '...' : ''}"\n`;
    });
    msg += '\n';
  }

  // Mismatch proof with full details
  if (a.mismatch_evidence?.length) {
    msg += `⚠️ **MISMATCH PROOF:**\n`;
    a.mismatch_evidence.slice(0, 2).forEach(m => {
      msg += `README: "${m.readme_section}"\n`;
      msg += `CODE: \`${m.code_anchor}\`\n`;
      msg += `→ ${m.conflict}\n\n`;
    });
  }

  // Full cut list
  if (a.cut.length > 0) {
    msg += `**CUT LIST** (${a.cut.length} files)\n`;
    msg += a.cut.slice(0, 10).map(f => `• ${f}`).join('\n');
    if (a.cut.length > 10) msg += `\n_+${a.cut.length - 10} more_`;
    msg += '\n\n';
  }

  // Blockers (detailed)
  if (a.pride_blockers?.length) {
    msg += `**BLOCKERS:**\n`;
    a.pride_blockers.forEach(b => {
      msg += `• ${b}\n`;
    });
    msg += '\n';
  }

  // Shareable angle (only in details)
  if (a.shareable_angle) {
    msg += `**SHAREABLE ANGLE:**\n"${a.shareable_angle}"`;
  } else if (a.tweet_draft) {
    msg += `**TWEET:**\n\`\`\`\n${a.tweet_draft}\n\`\`\``;
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

export interface ScanVerdictCounts {
  ship: number;
  cut: number;
  no_core: number;
  dead: number;
  shipped: number;
}

/**
 * Richer scan progress showing current repo and verdict breakdown
 */
export function formatScanProgressV2(
  done: number,
  total: number,
  currentRepo: string | null,
  verdicts: ScanVerdictCounts,
  cached: number
): string {
  const lines: string[] = [];

  lines.push(`⏳ ${done}/${total} repos analyzed`);
  if (currentRepo) {
    lines.push(`Currently: **${currentRepo}**`);
  }
  lines.push('');

  // Verdict breakdown (only show non-zero)
  const parts: string[] = [];
  if (verdicts.ship > 0) parts.push(`🟢 ${verdicts.ship} ship`);
  if (verdicts.cut > 0) parts.push(`🟡 ${verdicts.cut} cut`);
  if (verdicts.no_core > 0) parts.push(`🔴 ${verdicts.no_core} no core`);
  if (verdicts.dead > 0) parts.push(`☠️ ${verdicts.dead} dead`);
  if (verdicts.shipped > 0) parts.push(`🏆 ${verdicts.shipped} shipped`);

  if (parts.length > 0) {
    lines.push(parts.join(' | '));
  }

  if (cached > 0) {
    lines.push(`_${cached} cached_`);
  }

  return lines.join('\n');
}

/**
 * Timeout/completion message with explicit skipped count
 */
export function formatScanTimeout(
  analyzed: number,
  total: number,
  verdicts: ScanVerdictCounts
): string {
  const skipped = total - analyzed;
  const lines: string[] = [];

  lines.push(`⏸ Stopped at timeout limit`);
  lines.push('');
  lines.push(`**Analyzed:** ${analyzed}/${total} repos`);
  if (skipped > 0) {
    lines.push(`**Skipped:** ${skipped} repos _(run /scan again)_`);
  }
  lines.push('');

  const parts: string[] = [];
  if (verdicts.ship > 0) parts.push(`🟢 ${verdicts.ship}`);
  if (verdicts.cut > 0) parts.push(`🟡 ${verdicts.cut}`);
  if (verdicts.no_core > 0) parts.push(`🔴 ${verdicts.no_core}`);
  if (verdicts.dead > 0) parts.push(`☠️ ${verdicts.dead}`);
  if (verdicts.shipped > 0) parts.push(`🏆 ${verdicts.shipped}`);

  if (parts.length > 0) {
    lines.push(parts.join(' | '));
  }

  return lines.join('\n');
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

// ============ MORNING STACK ============

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

  // Only show live link if homepage is set in GitHub repo settings
  if (card.homepage) {
    lines.push(`**${card.repo}** ${stageLabel(card.stage)} • [live](${card.homepage})`);
  } else {
    lines.push(`**${card.repo}** ${stageLabel(card.stage)}`);
  }
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

// ============ PROGRESS FORMATTING ============

/**
 * Format card generation progress for streaming updates
 */
export function formatCardProgress(progress: CardProgress): string {
  const { step, repoName, stage, potential } = progress;

  switch (step) {
    case 'selecting':
      return '🔍 Finding your next task...';

    case 'loading':
      return `🔍 Loading **${repoName}**...`;

    case 'analyzing':
      return `📊 **${repoName}** • ${stageLabel(stage as ProjectStage)}\n\n💡 Analyzing potential...`;

    case 'context':
      return `📊 **${repoName}** • ${stageLabel(stage as ProjectStage)}\n\n_"${potential}"_\n\n📝 Getting context...`;

    case 'next_step':
      return `📊 **${repoName}** • ${stageLabel(stage as ProjectStage)}\n\n_"${potential}"_\n\n🎯 Determining next step...`;

    case 'complete':
      return `✅ Ready`;

    default:
      return '⏳ Working...';
  }
}

/**
 * Format card generation error with context
 */
export function formatCardError(error: string, repoName?: string): string {
  const lines: string[] = [];

  if (repoName) {
    lines.push(`❌ Failed to load **${repoName}**`);
  } else {
    lines.push('❌ Failed to generate card');
  }

  lines.push('');
  lines.push(`_${error}_`);

  return lines.join('\n');
}
