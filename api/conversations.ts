export const config = {
  runtime: 'edge',
};

import { stateManager } from '../lib/state.js';

// Debug endpoint to view tracked repos
export default async function handler() {
  try {
    const repos = await stateManager.getAllTrackedRepos();
    const counts = await stateManager.getRepoCounts();
    
    return new Response(JSON.stringify({
      counts,
      repos: repos.map(r => ({
        name: r.name,
        state: r.state,
        verdict: r.analysis?.verdict,
        one_liner: r.analysis?.one_liner,
        analyzed_at: r.analyzed_at,
      })),
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
