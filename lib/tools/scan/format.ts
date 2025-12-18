/**
 * Scan Formatting
 */

import { InlineKeyboard } from 'grammy';
import type { TrackedRepo } from '../../core/types.js';

export interface ScanVerdictCounts {
  ship: number;
  cut: number;
  no_core: number;
  dead: number;
  shipped: number;
}

export interface GroupedRepos {
  ship: TrackedRepo[];
  cut: TrackedRepo[];
  no_core: TrackedRepo[];
  dead: TrackedRepo[];
  shipped: TrackedRepo[];
}

/**
 * Format scan progress
 */
export function formatScanProgress(
  done: number,
  total: number,
  currentRepo: string | null,
  verdicts: ScanVerdictCounts,
  cached: number
): string {
  const pct = Math.round((done / total) * 100);
  const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
  
  let msg = `🔍 **Scanning** ${done}/${total}\n`;
  msg += `${bar} ${pct}%\n\n`;
  
  if (currentRepo) {
    msg += `📂 ${currentRepo}...\n\n`;
  }
  
  // Show running totals
  const counts: string[] = [];
  if (verdicts.ship > 0) counts.push(`🟢${verdicts.ship}`);
  if (verdicts.cut > 0) counts.push(`🟡${verdicts.cut}`);
  if (verdicts.no_core > 0) counts.push(`🔴${verdicts.no_core}`);
  if (verdicts.dead > 0) counts.push(`☠️${verdicts.dead}`);
  if (verdicts.shipped > 0) counts.push(`🚀${verdicts.shipped}`);
  
  if (counts.length > 0) {
    msg += counts.join(' ');
  }
  
  if (cached > 0) {
    msg += `\n_${cached} from cache_`;
  }
  
  return msg;
}

/**
 * Format scan summary
 */
export function formatScanSummary(groups: GroupedRepos): string {
  const total = groups.ship.length + groups.cut.length + groups.no_core.length + groups.dead.length;
  
  let msg = `✅ **Scan Complete** (${total} repos)\n\n`;
  
  if (groups.ship.length > 0) {
    msg += `🟢 **Ready to Ship** (${groups.ship.length})\n`;
    msg += groups.ship.slice(0, 5).map(r => `  • ${r.name}`).join('\n');
    if (groups.ship.length > 5) msg += `\n  _+${groups.ship.length - 5} more_`;
    msg += '\n\n';
  }
  
  if (groups.cut.length > 0) {
    msg += `🟡 **Cut to Core** (${groups.cut.length})\n`;
    msg += groups.cut.slice(0, 5).map(r => `  • ${r.name}`).join('\n');
    if (groups.cut.length > 5) msg += `\n  _+${groups.cut.length - 5} more_`;
    msg += '\n\n';
  }
  
  if (groups.no_core.length > 0) {
    msg += `🔴 **No Core** (${groups.no_core.length})\n`;
    msg += groups.no_core.slice(0, 3).map(r => `  • ${r.name}`).join('\n');
    if (groups.no_core.length > 3) msg += `\n  _+${groups.no_core.length - 3} more_`;
    msg += '\n\n';
  }
  
  if (groups.dead.length > 0) {
    msg += `☠️ **Dead** (${groups.dead.length})\n`;
  }
  
  if (groups.shipped.length > 0) {
    msg += `🚀 **Already Shipped** (${groups.shipped.length})\n`;
  }
  
  return msg.trim();
}

/**
 * Format timeout message
 */
export function formatScanTimeout(
  done: number,
  total: number,
  verdicts: ScanVerdictCounts
): string {
  let msg = `⏱️ **Timeout** (${done}/${total} analyzed)\n\n`;
  msg += `Results so far:\n`;
  if (verdicts.ship > 0) msg += `🟢 Ship: ${verdicts.ship}\n`;
  if (verdicts.cut > 0) msg += `🟡 Cut: ${verdicts.cut}\n`;
  if (verdicts.no_core > 0) msg += `🔴 No Core: ${verdicts.no_core}\n`;
  if (verdicts.dead > 0) msg += `☠️ Dead: ${verdicts.dead}\n`;
  msg += `\nRun \`/scan\` again to continue.`;
  return msg;
}

/**
 * Summary keyboard
 */
export function summaryKeyboard(groups: GroupedRepos): InlineKeyboard {
  const kb = new InlineKeyboard();
  
  if (groups.ship.length > 0) {
    kb.text(`🟢 Ship (${groups.ship.length})`, 'cat:ship');
  }
  if (groups.cut.length > 0) {
    kb.text(`🟡 Cut (${groups.cut.length})`, 'cat:cut');
  }
  
  return kb;
}

