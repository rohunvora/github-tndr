export const config = {
  runtime: 'edge',
};

export default async function handler(_req: Request) {
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Simple test endpoint works',
    env: {
      hasGithubToken: !!process.env.GITHUB_TOKEN,
      hasVercelToken: !!process.env.VERCEL_TOKEN,
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    }
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

