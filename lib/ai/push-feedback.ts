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
 * - Encourages progress, gently challenges yak-shaving
 * - Keeps it brief (push notification, not essay)
 */
export async function generatePushFeedback(
  anthropic: Anthropic,
  context: PushContext
): Promise<string> {
  const { repoName, fullName, commits, analysis } = context;

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

  // Build context about the repo if we have analysis
  let repoContext = '';
  if (analysis) {
    repoContext = `
Repo context (from prior analysis):
- Core value: ${analysis.core_value || 'Unknown'}
- Verdict: ${analysis.verdict}
- Pride blockers: ${analysis.pride_blockers?.join(', ') || 'None identified'}
- Files to cut: ${analysis.cut?.length || 0} files
- One-liner: ${analysis.code_one_liner || analysis.one_liner || 'N/A'}`;
  } else {
    repoContext = `
Repo context: Unknown (not yet analyzed with /repo command)`;
  }

  const prompt = `You are the user's cofounder and accountability partner. They just pushed code to ${repoName}.

Commits this session:
${commitSummary}
${repoContext}

Respond in 1-3 sentences like a real cofounder would when they see a teammate push code. Be:
- SPECIFIC about what they actually did (reference the commits)
- Encouraging if it's progress toward shipping
- Gently challenging if it looks like yak-shaving or distraction
- Brief — this is a push notification, not a review

${analysis ? `If relevant, relate this to their blockers or goals.` : `Since we haven't analyzed this repo, just comment on what you see in the commits. Suggest they run /repo ${repoName} if they want deeper tracking.`}

Do NOT:
- Be generic ("Great work!")
- Be sycophantic
- Write more than 3 sentences
- Use emojis excessively

Just respond with the message text, no preamble.`;

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

