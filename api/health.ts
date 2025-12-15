export const config = {
  runtime: 'edge',
};

// Health check endpoint to debug configuration
export default async function handler(req: Request) {
  const envCheck = {
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    USER_TELEGRAM_CHAT_ID: !!process.env.USER_TELEGRAM_CHAT_ID,
    GITHUB_TOKEN: !!process.env.GITHUB_TOKEN,
    VERCEL_TOKEN: !!process.env.VERCEL_TOKEN,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
  };

  const allSet = Object.values(envCheck).every(v => v);

  return new Response(JSON.stringify({
    status: allSet ? 'ok' : 'missing_env',
    env: envCheck,
    timestamp: new Date().toISOString(),
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

