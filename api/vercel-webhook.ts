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

interface VercelWebhookEvent {
  type: string;
  payload: {
    deployment?: {
      name?: string;
      url?: string;
      readyState?: string;
      createdAt?: number;
    };
    project?: {
      name?: string;
    };
  };
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const event = await req.json() as VercelWebhookEvent;
    const eventType = event.type;

    // Handle deployment events
    if (eventType === 'deployment.created' || eventType === 'deployment.ready' || eventType === 'deployment.error') {
      const projectName = event.payload.deployment?.name || event.payload.project?.name || 'unknown';
      const deployment = event.payload.deployment;
      
      if (!deployment) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const deployStatus = deployment.readyState?.toLowerCase() || 'building';
      const previewUrl = deployment.url ? `https://${deployment.url}` : null;

      // Update project state
      await stateManager.setProjectState(projectName, {
        repo: projectName,
        description: null,
        lastCommit: null,
        lastCommitMessage: null,
        vercelProject: projectName,
        lastDeploy: new Date(deployment.createdAt || Date.now()).toISOString(),
        deployStatus: deployStatus as 'ready' | 'building' | 'error',
        previewUrl,
        launchedAt: null,
        launchUrl: null,
        userFeedback: [],
        status: 'deployed',
      });

      // Only send message for ready or error states
      if (deployStatus === 'ready' || deployStatus === 'error') {
        const message = await agent.generateMessage({
          trigger: 'webhook',
          eventType: 'deploy',
          projectName,
        });

        await sendMessage(bot, chatId, message);

        await stateManager.addConversationMessage({
          role: 'assistant',
          content: message,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Vercel webhook error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
