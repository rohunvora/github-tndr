import { Bot, Context } from 'grammy';

export function createBot(token: string) {
  return new Bot(token);
}

export async function sendMessage(bot: Bot, chatId: string, text: string): Promise<void> {
  await bot.api.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
  });
}

export function setupMessageHandler(bot: Bot, handler: (ctx: Context) => Promise<void>) {
  bot.on('message', handler);
}

