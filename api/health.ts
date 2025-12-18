export const config = {
  runtime: 'edge',
};

import { getAIHealthStatus, TASK_ROUTING } from '../lib/config.js';

// Health check endpoint to debug configuration
export default async function handler(req: Request) {
  const envCheck = {
    // Telegram
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    USER_TELEGRAM_CHAT_ID: !!process.env.USER_TELEGRAM_CHAT_ID,
    // GitHub
    GITHUB_TOKEN: !!process.env.GITHUB_TOKEN,
    // Vercel
    VERCEL_TOKEN: !!process.env.VERCEL_TOKEN,
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    // AI Providers
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    GOOGLE_AI_KEY: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
  };

  const aiStatus = getAIHealthStatus();
  const allSet = Object.values(envCheck).every(v => v);

  return new Response(JSON.stringify({
    status: allSet ? 'ok' : 'missing_env',
    env: envCheck,
    ai: {
      providers: aiStatus,
      routing: Object.fromEntries(
        Object.entries(TASK_ROUTING).map(([task, config]) => [
          task,
          `${config.provider}/${config.model.split('-').slice(0, 2).join('-')}`,
        ])
      ),
    },
    timestamp: new Date().toISOString(),
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

