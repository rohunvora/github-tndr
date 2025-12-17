import Anthropic from '@anthropic-ai/sdk';
import { CoreAnalysis } from '../core-types.js';
import { AI_MODEL } from '../config.js';

interface PushContext {
  repoName: string;
  fullName: string;
  commits: Array<{
    message: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  analysis?: CoreAnalysis | null;
}

/**
 * Generate cofounder-style feedback on a push
 * The AI acts as an accountability partner who:
 * - Is specific about what was done
 * - Relates it to stated goals/blockers (if known)
 * - Keeps it brief (push notification, not essay)
 */
export async function generatePushFeedback(
  anthropic: Anthropic,
  context: PushContext
): Promise<string> {
  const { repoName, commits, analysis } = context;

  // Summarize the commits
  const commitSummary = commits.map(c => {
    const files = [
      ...c.added.map(f => `+${f}`),
      ...c.removed.map(f => `-${f}`),
      ...c.modified.map(f => `~${f}`),
    ].slice(0, 5); // Limit files shown
    const moreFiles = c.added.length + c.removed.length + c.modified.length - files.length;
    const fileStr = files.join(', ') + (moreFiles > 0 ? ` (+${moreFiles} more)` : '');
    return `- "${c.message}" [${fileStr}]`;
  }).join('\n');

  // TWO COMPLETELY DIFFERENT PATHS based on whether we have analysis
  let prompt: string;

  if (analysis) {
    // KNOWN REPO: Has prior analysis, can reference blockers/goals
    prompt = `You are the user's cofounder. They just pushed code to ${repoName}.

Commits:
${commitSummary}

Repo context:
- Core value: ${analysis.core_value || 'Unknown'}
- Verdict: ${analysis.verdict}
- Pride blockers: ${analysis.pride_blockers?.join(', ') || 'None identified'}
- One-liner: ${analysis.code_one_liner || analysis.one_liner || 'N/A'}

Respond in 1-2 sentences. Be SPECIFIC about what they did. If relevant, relate to their blockers or goals.

Do NOT:
- Be generic ("Great work!")
- Be sycophantic
- End with a question (users can't reply to push notifications)
- Write more than 2 sentences
- Challenge or critique (save that for /next cards)

Just respond with the message text, no preamble.`;
  } else {
    // NEW REPO: Never analyzed, don't hallucinate context
    prompt = `You are the user's cofounder. They just pushed code to ${repoName}, which I haven't seen before.

Commits:
${commitSummary}

This is a NEW repo I haven't analyzed yet. Based ONLY on the commit messages and file names, write a brief 1-sentence acknowledgment of what they're building.

End with: "Tap Analyze to start tracking this project."

Do NOT:
- Mention "blockers", "goals", "prior analysis" or anything you don't actually know
- Ask questions (users can't reply to push notifications)
- Be generic or sycophantic
- Write more than 2 sentences total

Just respond with the message text, no preamble.`;
  }

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0];
  if (text.type !== 'text') {
    return `Pushed ${commits.length} commit${commits.length > 1 ? 's' : ''} to ${repoName}.`;
  }

  return text.text.trim();
}

