export const config = {
  runtime: 'edge',
};

import { Agent } from '../../lib/agent.js';
import { sendMessage, createBot } from '../../lib/telegram.js';
import { stateManager } from '../../lib/state.js';

const bot = createBot(process.env.TELEGRAM_BOT_TOKEN!);
const chatId = process.env.USER_TELEGRAM_CHAT_ID!.trim();

const agent = new Agent(
  process.env.ANTHROPIC_API_KEY!,
  process.env.GITHUB_TOKEN!,
  process.env.VERCEL_TOKEN!,
  process.env.VERCEL_TEAM_ID
);

export default async function handler() {
  try {
    await agent.syncProjectStates();

    const message = await agent.generateMessage({
      trigger: 'cron',
      eventType: 'evening',
    });

    await sendMessage(bot, chatId, message);

    await stateManager.addConversationMessage({
      role: 'assistant',
      content: message,
      timestamp: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Evening cron error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

