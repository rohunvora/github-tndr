import { Agent } from '../lib/agent.js';
import { sendMessage, createBot } from '../lib/telegram.js';
import { stateManager } from '../lib/state.js';
import crypto from 'node:crypto';

const bot = createBot(process.env.TELEGRAM_BOT_TOKEN!);
const chatId = process.env.USER_TELEGRAM_CHAT_ID!;

const agent = new Agent(
  process.env.ANTHROPIC_API_KEY!,
  process.env.GITHUB_TOKEN!,
  process.env.VERCEL_TOKEN!,
  process.env.VERCEL_TEAM_ID
);

function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.text();
    const signature = req.headers.get('x-hub-signature-256') || '';

    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret && !verifyGitHubSignature(payload, signature, webhookSecret)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const event = JSON.parse(payload);
    const eventType = req.headers.get('x-github-event');

    // Only handle push events for now
    if (eventType === 'push') {
      const repoName = event.repository.name;
      const commitMessage = event.head_commit?.message || 'No message';
      const commitSha = event.head_commit?.id?.substring(0, 7) || 'unknown';

      // Update project state
      await stateManager.setProjectState(repoName, {
        lastCommit: event.head_commit?.timestamp || new Date().toISOString(),
        lastCommitMessage: commitMessage.split('\n')[0],
      });

      // Generate response
      const message = await agent.generateMessage({
        trigger: 'webhook',
        eventType: 'commit',
        projectName: repoName,
      });

      await sendMessage(bot, chatId, message);

      await stateManager.addConversationMessage({
        role: 'assistant',
        content: message,
        timestamp: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('GitHub webhook error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

