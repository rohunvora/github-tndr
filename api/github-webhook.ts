export const config = {
  runtime: 'edge',
};

import { Agent } from '../lib/agent.js';
import { sendMessage, createBot } from '../lib/telegram.js';
import { stateManager } from '../lib/state.js';

const bot = createBot(process.env.TELEGRAM_BOT_TOKEN!);
const chatId = process.env.USER_TELEGRAM_CHAT_ID!;

const agent = new Agent(
  process.env.ANTHROPIC_API_KEY!,
  process.env.GITHUB_TOKEN!,
  process.env.VERCEL_TOKEN!,
  process.env.VERCEL_TEAM_ID
);

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.text();
    const event = JSON.parse(payload);
    const eventType = req.headers.get('x-github-event');

    // Only handle push events for now
    if (eventType === 'push') {
      const repoName = event.repository?.name || 'unknown';
      const commitMessage = event.head_commit?.message || 'No message';

      // Update project state
      await stateManager.setProjectState(repoName, {
        repo: repoName,
        description: null,
        lastCommit: event.head_commit?.timestamp || new Date().toISOString(),
        lastCommitMessage: commitMessage.split('\n')[0],
        vercelProject: null,
        lastDeploy: null,
        deployStatus: null,
        previewUrl: null,
        launchedAt: null,
        launchUrl: null,
        userFeedback: [],
        status: 'building',
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
