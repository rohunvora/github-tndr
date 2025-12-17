import Anthropic from '@anthropic-ai/sdk';
import { CoreAnalysis } from '../core-types.js';
import { AI_MODEL } from '../config.js';
import { PortfolioSnapshot, formatPortfolioForPrompt } from '../portfolio.js';

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
  portfolio?: PortfolioSnapshot | null;  // NEW: Portfolio context
}

/**
 * Generate cofounder-style feedback on a push
 * Now portfolio-aware: can relate this push to user's overall work
 */
export async function generatePushFeedback(
  anthropic: Anthropic,
  context: PushContext
): Promise<string> {
  const { repoName, fullName, commits, analysis, portfolio } = context;

  // Summarize the commits
  const commitSummary = commits.map(c => {
    const files = [
      ...c.added.map(f => `+${f}`),
      ...c.removed.map(f => `-${f}`),
      ...c.modified.map(f => `~${f}`),
    ].slice(0, 5);
    const moreFiles = c.added.length + c.removed.length + c.modified.length - files.length;
    const fileStr = files.join(', ') + (moreFiles > 0 ? ` (+${moreFiles} more)` : '');
    return `- "${c.message}" [${fileStr}]`;
  }).join('\n');

  // Build portfolio context string (keep it small for LLM)
  const portfolioContext = portfolio ? formatPortfolioForPrompt(portfolio) : null;
  
  // Determine if this is the user's stated focus
  const isFocus = portfolio?.focus === fullName;
  
  // Count other active projects
  const otherActiveCount = portfolio 
    ? portfolio.counts.active - (portfolio.projects.find(p => p.full_name === fullName)?.status === 'active' ? 1 : 0)
    : 0;

  let prompt: string;

  if (analysis) {
    // KNOWN REPO: Has prior analysis
    prompt = `You are the user's cofounder. They just pushed code to ${repoName}.

Commits:
${commitSummary}

Repo context:
- Core value: ${analysis.core_value || 'Unknown'}
- Verdict: ${analysis.verdict}
- Pride blockers: ${analysis.pride_blockers?.join(', ') || 'None identified'}
- One-liner: ${analysis.code_one_liner || analysis.one_liner || 'N/A'}

${portfolioContext ? `Portfolio context:\n${portfolioContext}\n` : ''}
${isFocus ? 'This repo IS their stated focus.' : portfolio?.focus ? `Their stated focus is ${portfolio.focus}, not this repo.` : ''}

Respond in 1-2 sentences. Be SPECIFIC about what they did.
${portfolioContext ? `You may briefly reference portfolio context if relevant (e.g., "1 of ${portfolio?.counts.active} active projects" or "your stated focus").` : ''}

Do NOT:
- Be generic ("Great work!")
- Be sycophantic
- End with a question (users can't reply to push notifications)
- Write more than 2 sentences
- Challenge or critique (save that for interactive sessions)
- Repeat information they already know

Just respond with the message text, no preamble.`;
  } else {
    // NEW REPO: Never analyzed
    prompt = `You are the user's cofounder. They just pushed code to ${repoName}, which I haven't analyzed yet.

Commits:
${commitSummary}

${portfolioContext ? `Portfolio context:\n${portfolioContext}\n` : ''}

This is a NEW repo I haven't analyzed. Based ONLY on the commit messages and file names, write a brief 1-sentence acknowledgment of what they're building.

${otherActiveCount > 0 ? `You may note they have ${otherActiveCount} other active project${otherActiveCount > 1 ? 's' : ''} if relevant.` : ''}

End with: "Tap Analyze to track this project."

Do NOT:
- Mention "blockers", "goals", "prior analysis" or anything you don't actually know
- Ask questions (users can't reply)
- Be generic or sycophantic
- Write more than 2 sentences total
- Judge whether this is a good use of time (save that for interactive sessions)

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
