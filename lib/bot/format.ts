import { TrackedRepo, RepoState } from '../core-types.js';

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

🟢 Ready to ship: ${counts.ready}
🟡 Has core (needs work): ${counts.has_core}
🔴 No core found: ${counts.no_core}
☠️ Dead: ${counts.dead}
🚀 Shipped: ${counts.shipped}
⏳ Analyzing: ${counts.analyzing}

Total tracked: ${counts.total}`;
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
