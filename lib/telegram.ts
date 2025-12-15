import { Bot, Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

// Bot info to avoid needing to call getMe()
const botInfo: UserFromGetMe = {
  id: 8243228118,
  is_bot: true,
  first_name: 'Pusher',
  username: 'pusher_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

export function createBot(token: string) {
  return new Bot(token, { botInfo });
}

export async function sendMessage(bot: Bot, chatId: string, text: string): Promise<void> {
  await bot.api.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
  });
}

export function setupMessageHandler(bot: Bot, handler: (ctx: Context) => Promise<void>) {
  bot.on('message', handler);
}
