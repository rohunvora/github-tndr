export const config = {
  runtime: 'edge',
};

import { stateManager } from '../lib/state.js';

// GitHub webhooks - update last_push_at for tracked repos
// Future: trigger re-analysis for repos with pending actions
export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.text();
    const event = JSON.parse(payload);
    const eventType = req.headers.get('x-github-event');

    if (eventType === 'push') {
      const fullName = event.repository?.full_name;
      
      if (fullName) {
        const [owner, name] = fullName.split('/');
        
        // Check if we're tracking this repo
        const tracked = await stateManager.getTrackedRepo(owner, name);
        
        if (tracked) {
          // Update last push time
          tracked.last_push_at = event.head_commit?.timestamp || new Date().toISOString();
          await stateManager.saveTrackedRepo(tracked);
          
          // TODO: If repo has pending_action, could trigger re-analysis here
          // For now, user needs to reply "done" to trigger re-analysis
          
          return new Response(JSON.stringify({ 
            success: true, 
            repo: fullName,
            action: 'updated_push_time',
            pending_action: tracked.pending_action,
          }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, action: 'ignored' }), {
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
