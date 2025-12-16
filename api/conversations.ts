export const config = {
  runtime: 'edge',
};

import { stateManager } from '../lib/state.js';

// Endpoint to view recent conversations and test responses
export default async function handler(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  
  try {
    const conversations = await stateManager.getRecentConversation(limit);
    const commitments = await stateManager.getCommitments();
    const projects = await stateManager.getAllProjects();
    
    // Format for easy reading
    const formatted = {
      recentMessages: conversations.map(c => ({
        role: c.role,
        content: c.content,
        time: new Date(c.timestamp).toLocaleString(),
      })),
      activeCommitments: commitments.filter(c => !c.resolved),
      trackedProjects: projects.length,
    };

    return new Response(JSON.stringify(formatted, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}




