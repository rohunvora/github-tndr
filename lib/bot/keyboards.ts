import { InlineKeyboard } from 'grammy';
import { TrackedRepo } from '../core-types.js';

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
