import Anthropic from '@anthropic-ai/sdk';
import { LastContext, LastContextOutputSchema } from '../core-types.js';
import { SHARED_PREAMBLE, parseJsonResponse } from './shared-preamble.js';

interface LastContextInput {
  recent_commits: Array<{
    sha: string;
    message: string;
    files_changed: string[];
  }>;
  last_bot_interaction?: string;
  open_intention?: {
    action: string;
    stated_at: string;
  };
}

const SYSTEM_PROMPT = `${SHARED_PREAMBLE}

Your task: Summarize where the user left off in 1 sentence.

Rules:
- Prefer concrete changes ("Added CTA to landing page") over vague language ("Made some updates")
- If there is an open intention (user said they would do something), restate it as the LAST context
- Do not guess or invent activity that isn't evidenced
- Keep it to ONE sentence max

Return ONLY valid JSON matching this schema:
{
  "last_context": "string (1 sentence summary of where they left off)",
  "last_work_order_status": "open" | "done" | "unknown",
  "confidence": "high" | "medium" | "low"
}`;

export async function generateLastContext(
  anthropic: Anthropic,
  input: LastContextInput
): Promise<LastContext> {
  // If there's an open intention, that takes priority
  if (input.open_intention) {
    return {
      last_context: `You said you'd "${input.open_intention.action}"`,
      last_work_order_status: 'open',
      confidence: 'high',
    };
  }

  // If no commits, return unknown
  if (input.recent_commits.length === 0) {
    return {
      last_context: 'No recent activity',
      last_work_order_status: 'unknown',
      confidence: 'low',
    };
  }

  const userPrompt = `Summarize where the user left off based on this activity:

Recent commits (newest first):
${input.recent_commits.slice(0, 5).map(c => 
  `- ${c.message.split('\n')[0]} (files: ${c.files_changed.slice(0, 3).join(', ')}${c.files_changed.length > 3 ? '...' : ''})`
).join('\n')}

${input.last_bot_interaction ? `Last bot interaction: ${input.last_bot_interaction}` : ''}

Summarize in 1 sentence what they were last working on.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    // Fallback to commit-based summary
    const latestCommit = input.recent_commits[0];
    return {
      last_context: latestCommit.message.split('\n')[0],
      last_work_order_status: 'unknown',
      confidence: 'medium',
    };
  }

  const parsed = parseJsonResponse<LastContext>(text.text);
  return LastContextOutputSchema.parse(parsed);
}
