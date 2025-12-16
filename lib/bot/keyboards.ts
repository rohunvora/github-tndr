import { InlineKeyboard } from 'grammy';
import { TrackedRepo } from '../core-types.js';
import { GroupedRepos, CategoryKey } from './format.js';

export function summaryKeyboard(groups: GroupedRepos): InlineKeyboard {
  const kb = new InlineKeyboard();
  
  // First row: main categories
  if (groups.ship.length > 0) kb.text(`🚀 Ship (${groups.ship.length})`, 'category:ship:0');
  if (groups.cut.length > 0) kb.text(`✂️ Cut (${groups.cut.length})`, 'category:cut:0');
  kb.row();
  
  // Second row: other categories
  if (groups.no_core.length > 0) kb.text(`🔴 No Core (${groups.no_core.length})`, 'category:no_core:0');
  if (groups.dead.length > 0) kb.text(`☠️ Dead (${groups.dead.length})`, 'category:dead:0');
  if (groups.shipped.length > 0) kb.text(`🏆 Shipped (${groups.shipped.length})`, 'category:shipped:0');
  kb.row();
  
  // Third row: show all
  kb.text('📋 Show All', 'category:all:0');
  
  return kb;
}

export function categoryKeyboard(
  category: CategoryKey,
  repos: TrackedRepo[],
  page: number,
  hasMore: boolean
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const pageSize = 5;
  const start = page * pageSize;
  
  // Repo buttons for this page (max 3 per row)
  const pageRepos = repos.slice(start, start + pageSize);
  for (let i = 0; i < pageRepos.length; i++) {
    const r = pageRepos[i];
    kb.text(`📄 ${r.name}`, `repo:${r.owner}:${r.name}`);
    if ((i + 1) % 2 === 0 || i === pageRepos.length - 1) kb.row();
  }
  
  // Pagination row
  if (page > 0 || hasMore) {
    if (page > 0) kb.text('◀️ Prev', `category:${category}:${page - 1}`);
    if (hasMore) kb.text('▶️ Next', `category:${category}:${page + 1}`);
    kb.row();
  }
  
  // Back to summary
  kb.text('◀️ Back to Summary', 'summary');
  
  return kb;
}

export function analysisKeyboard(repo: TrackedRepo): InlineKeyboard {
  const kb = new InlineKeyboard();
  const id = `${repo.owner}:${repo.name}`;
  const verdict = repo.analysis?.verdict;

  if (!verdict) {
    return kb.text('🔄 Retry', `retry:${id}`);
  }

  switch (verdict) {
    case 'ship':
      kb.text('🚀 Post this', `ship:${id}`);
      kb.text('✏️ Edit tweet', `edit:${id}`);
      kb.row();
      kb.text('⏸️ Not yet', `skip:${id}`);
      break;
    case 'cut_to_core':
      kb.text('✂️ Cut to core', `cut:${id}`);
      kb.text('🚀 Ship as-is', `ship:${id}`);
      kb.row();
      kb.text('☠️ Kill', `kill:${id}`);
      break;
    case 'no_core':
      kb.text('🔍 Dig deeper', `deeper:${id}`);
      kb.text('☠️ Kill', `kill:${id}`);
      break;
    case 'dead':
      kb.text('☠️ Kill', `kill:${id}`);
      kb.text('🔄 Revive', `revive:${id}`);
      break;
  }

  return kb;
}

export function toneKeyboard(owner: string, name: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('😎 Casual', `tone:${owner}:${name}:casual`)
    .text('💼 Pro', `tone:${owner}:${name}:pro`)
    .row()
    .text('🔧 Tech', `tone:${owner}:${name}:tech`)
    .text('🔥 Hype', `tone:${owner}:${name}:hype`)
    .row()
    .text('❌ Cancel', `cancelaction:${owner}:${name}`);
}

export function nextActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔍 Scan again', 'quickscan')
    .text('📋 Status', 'showstatus');
}

export function startKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔍 Scan Last 10 Days', 'quickscan')
    .text('📋 Status', 'showstatus');
}

export function retryKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🔄 Retry', 'quickscan');
}
