/**
 * Next Tool Formatting
 * Carousel card UI
 */

import { InlineKeyboard } from 'grammy';
import type { ProjectCandidate } from './selector.js';

const momentumEmoji = {
  high: '🔥',
  medium: '⚡',
  low: '💤',
};

const verdictEmoji: Record<string, string> = {
  ship: '🟢',
  cut_to_core: '🟡',
  no_core: '🔴',
  dead: '☠️',
};

/**
 * Format a carousel card
 */
export function formatCarouselCard(
  candidate: ProjectCandidate,
  index: number,
  total: number
): string {
  const { repo, reason, momentum, daysSinceCommit } = candidate;
  const a = repo.analysis!;

  let msg = `${momentumEmoji[momentum]} **${repo.name}** (${index + 1}/${total})\n\n`;

  // One-liner
  msg += `${a.code_one_liner || a.one_liner}\n\n`;

  // Verdict
  const emoji = verdictEmoji[a.verdict] || '⚪';
  msg += `${emoji} ${a.verdict.replace('_', ' ').toUpperCase()}\n`;

  // Reason for selection
  msg += `💡 ${reason}\n`;

  // Activity
  if (daysSinceCommit === 0) {
    msg += `📅 Active today\n`;
  } else if (daysSinceCommit === 1) {
    msg += `📅 Active yesterday\n`;
  } else {
    msg += `📅 ${daysSinceCommit} days since last commit\n`;
  }

  // Pride
  if (a.pride_level) {
    const prideEmoji = a.pride_level === 'proud' ? '🟢' : a.pride_level === 'comfortable' ? '🟡' : '😐';
    msg += `Pride: ${prideEmoji} ${a.pride_level}\n`;
  }

  // Next action hint
  if (a.verdict === 'ship' && a.tweet_draft) {
    msg += `\n→ Ready to launch!`;
  } else if (a.verdict === 'cut_to_core' && a.cut.length > 0) {
    msg += `\n→ Cut ${a.cut.length} files to focus`;
  }

  return msg;
}

/**
 * Format no projects available message
 */
export function formatNoProjects(): string {
  return `📭 **No active projects**

Use \`/scan\` to analyze your repos first.`;
}

/**
 * Carousel navigation keyboard
 */
export function carouselKeyboard(
  sessionId: string,
  index: number,
  total: number
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Navigation row
  if (index > 0) {
    kb.text('← Prev', `next_prev:${sessionId}`);
  }
  
  kb.text('🎯 Work on this', `next_select:${sessionId}`);
  
  if (index < total - 1) {
    kb.text('Next →', `next_next:${sessionId}`);
  }

  return kb;
}

/**
 * Format selection confirmation
 */
export function formatSelected(repoName: string): string {
  return `🎯 **Working on: ${repoName}**

Good luck! Use \`/next\` again when you're ready for the next one.`;
}

