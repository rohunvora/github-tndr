import { Bot, Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

// Generate botInfo dynamically from token (token format: BOT_ID:SECRET)
function getBotInfo(token: string): UserFromGetMe {
  const botId = parseInt(token.split(':')[0], 10);
  return {
    id: botId,
    is_bot: true,
    first_name: 'Pusher',
    username: 'pusher_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  };
}

export function createBot(token: string) {
  return new Bot(token, { botInfo: getBotInfo(token) });
}

export async function sendMessage(bot: Bot, chatId: string, text: string): Promise<void> {
  await bot.api.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
  });
}

export function setupMessageHandler(bot: Bot, handler: (ctx: Context) => Promise<void>) {
  bot.on('message', handler);
}
