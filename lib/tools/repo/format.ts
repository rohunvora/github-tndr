/**
 * Repo Formatting for Telegram
 */

import type { TrackedRepo, CoreAnalysis } from '../../core/types.js';

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
 */
export function formatCard(repo: TrackedRepo): string {
  const a = repo.analysis;
  if (!a) return `━━━ ${repo.name} ━━━\n❌ Analysis failed`;

  const emoji = verdictEmoji[a.verdict] || '⚪';
  const label = verdictLabel[a.verdict] || a.verdict.toUpperCase();
  
  const codeLine = a.code_one_liner || a.one_liner;
  
  let msg = `━━━ ${repo.name} ━━━\n`;
  msg += `${emoji} **${label}**\n\n`;
  msg += `${codeLine}\n`;
  
  // Mismatch flag
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

  // Pride
  const pride = a.pride_level || 'neutral';
  const blockerCount = a.pride_blockers?.length || 0;
  msg += `\nPride: ${prideEmoji[pride] || '😐'} ${pride}`;
  if (blockerCount > 0) msg += ` (${blockerCount} blocker${blockerCount > 1 ? 's' : ''})`;

  return msg;
}

/**
 * Full details view — shown when "More" is tapped
 */
export function formatDetails(repo: TrackedRepo): string {
  const a = repo.analysis;
  if (!a) return `━━━ ${repo.name} ━━━\n❌ No analysis`;

  let msg = `📋 **${repo.name}** — Details\n\n`;

  // Core evidence
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

  // README claims
  if (a.readme_claims?.length) {
    msg += `**README CLAIMS:**\n`;
    a.readme_claims.slice(0, 3).forEach(claim => {
      const icon = claim.support === 'supported' ? '✓' : claim.support === 'partial' ? '~' : '✗';
      msg += `${icon} "${claim.claim.slice(0, 50)}${claim.claim.length > 50 ? '...' : ''}"\n`;
    });
    msg += '\n';
  }

  // Mismatch proof
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

  // Blockers
  if (a.pride_blockers?.length) {
    msg += `**BLOCKERS:**\n`;
    a.pride_blockers.forEach(b => {
      msg += `• ${b}\n`;
    });
    msg += '\n';
  }

  // Shareable angle
  if (a.shareable_angle) {
    msg += `💡 **Shareable:** ${a.shareable_angle}\n`;
  }

  return msg;
}

/**
 * Format progress phases for analysis
 */
type Phase = 'resolving' | 'fetching' | 'analyzing' | 'formatting' | 'done';

export function formatProgressMessage(input: string, phase: Phase, elapsed?: number): string {
  const phases: Record<Phase, string> = {
    resolving: '⏳ resolving repo...',
    fetching: '✓ resolved\n⏳ fetching repo data...',
    analyzing: '✓ resolved\n✓ fetched\n⏳ running analysis...',
    formatting: '✓ resolved\n✓ fetched\n✓ analyzed\n⏳ formatting...',
    done: '✓ resolved\n✓ fetched\n✓ analyzed\n✓ done',
  };
  
  let msg = `🔍 **${input}**\n\n${phases[phase]}`;
  
  const HEARTBEAT_THRESHOLD = 10000;
  if (elapsed && elapsed > HEARTBEAT_THRESHOLD && phase !== 'done') {
    msg += `\n_still working..._`;
  }
  
  return msg;
}

/**
 * Convert verdict to repo state
 */
export function verdictToState(verdict: string): TrackedRepo['state'] {
  switch (verdict) {
    case 'ship': return 'ready';
    case 'cut_to_core': return 'has_core';
    case 'no_core': return 'no_core';
    case 'dead': return 'dead';
    default: return 'unanalyzed';
  }
}

