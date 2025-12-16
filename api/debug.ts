export const config = {
  runtime: 'edge',
};

import { kv } from '@vercel/kv';

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'read';
  
  try {
    if (action === 'write') {
      // Test write
      await kv.set('debug:test', { 
        timestamp: new Date().toISOString(),
        message: 'KV is working!' 
      });
      return new Response(JSON.stringify({ success: true, action: 'write' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (action === 'read') {
      // Test read
      const testData = await kv.get('debug:test');
      const conversations = await kv.get('memory:recent');
      const commitments = await kv.get('memory:commitments');
      
      return new Response(JSON.stringify({
        testData,
        conversationCount: Array.isArray(conversations) ? conversations.length : 0,
        conversations: conversations || [],
        commitments: commitments || [],
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Unknown action', { status: 400 });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}




