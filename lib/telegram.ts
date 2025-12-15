import { Bot, Context, InputFile } from 'grammy';
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
    link_preview_options: { is_disabled: false },
  });
}

export async function sendMessageWithScreenshot(
  bot: Bot,
  chatId: string,
  text: string,
  screenshotUrl: string | null
): Promise<void> {
  if (screenshotUrl) {
    try {
      // Try to fetch and send the screenshot
      const screenshot = await fetchScreenshot(screenshotUrl);
      
      if (screenshot) {
        await bot.api.sendPhoto(chatId, new InputFile(screenshot, 'preview.png'), {
          caption: text,
          parse_mode: 'Markdown',
        });
        return;
      }
    } catch (error) {
      console.error('Failed to send screenshot:', error);
      // Fall back to text-only
    }
  }
  
  // Send text-only message
  await sendMessage(bot, chatId, text);
}

async function fetchScreenshot(url: string): Promise<Uint8Array | null> {
  try {
    // The URL is already a microlink API URL that returns screenshot data
    const response = await fetch(url);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json() as { data?: { screenshot?: { url?: string } } };
    const imageUrl = data?.data?.screenshot?.url;
    
    if (!imageUrl) {
      return null;
    }
    
    // Fetch the actual image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return null;
    }
    
    const arrayBuffer = await imageResponse.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

export function setupMessageHandler(bot: Bot, handler: (ctx: Context) => Promise<void>) {
  bot.on('message', handler);
}
