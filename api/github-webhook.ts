export const config = {
  runtime: 'edge',
};

import { stateManager } from '../lib/state.js';

// GitHub webhooks just update state - let cron handle messaging (dedupe)
export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.text();
    const event = JSON.parse(payload);
    const eventType = req.headers.get('x-github-event');

    if (eventType === 'push') {
      const repoName = event.repository?.name;
      
      if (repoName) {
        // Just update state - cron will handle messaging with dedupe
        await stateManager.setProjectState(repoName, {
          repo: event.repository?.full_name || repoName,
          description: event.repository?.description || null,
          lastCommit: event.head_commit?.timestamp || new Date().toISOString(),
          lastCommitMessage: event.head_commit?.message?.split('\n')[0] || null,
          status: 'building',
        });
      }
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
