// ============ ANALYSIS PROMPT ============

export function buildAnalysisPrompt(ctx: {
  owner: string;
  repo: string;
  description: string | null;
  readme: string;
  packageJson: string;
  fileTree: string;
  commitSignals: { velocity: 'active' | 'stale'; coherence: 'focused' | 'chaotic'; days_since_last: number; recent_messages: string[] };
}): string {
  return `You are a sharp, no-BS repo analyst. Find the core valuable thing in this repository.

## Repository: ${ctx.owner}/${ctx.repo}
${ctx.description ? `Description: ${ctx.description}` : ''}

## README
\`\`\`
${ctx.readme.substring(0, 3000)}
\`\`\`

## package.json
\`\`\`json
${ctx.packageJson.substring(0, 1500)}
\`\`\`

## File Structure
\`\`\`
${ctx.fileTree}
\`\`\`

## Commit Signals
- Activity: ${ctx.commitSignals.velocity} (${ctx.commitSignals.days_since_last} days since last commit)
- Commit style: ${ctx.commitSignals.coherence}
- Recent commits: ${ctx.commitSignals.recent_messages.slice(0, 3).join(', ') || 'none'}

## Rules
1. "Core" = ONE novel/valuable thing. Everything else is bloat.
2. Multiple products = recommend cutting to core.
3. No clear value = verdict "no_core" or "dead".
4. keep/cut lists must be DISJOINT.
5. Only list files from the structure above.
6. tweet_draft under 280 chars, no hashtags.

## Verdicts
- "ship": Ready to launch. Clear value, focused.
- "cut_to_core": Valuable core buried under bloat.
- "no_core": No clear value found.
- "dead": Abandoned, no value.

Return ONLY valid JSON:
{
  "one_liner": "One sentence, max 140 chars",
  "what_it_does": "2-3 sentences",
  "has_core": true/false,
  "core_value": "The one valuable thing (or null)",
  "why_core": "Why this is the core (or null)",
  "keep": ["files/to/keep"],
  "cut": ["files/to/cut"],
  "verdict": "ship" | "cut_to_core" | "no_core" | "dead",
  "verdict_reason": "Why this verdict",
  "tweet_draft": "Draft tweet if ship-ready, else null"
}`;
}

// ============ RETRY PROMPT ============

export function buildRetryPrompt(previousResponse: string): string {
  return `Your previous response was not valid JSON. Return ONLY valid JSON:
${previousResponse.substring(0, 500)}

{
  "one_liner": "string",
  "what_it_does": "string",
  "has_core": boolean,
  "core_value": "string or null",
  "why_core": "string or null",
  "keep": ["files"],
  "cut": ["files"],
  "verdict": "ship" | "cut_to_core" | "no_core" | "dead",
  "verdict_reason": "string",
  "tweet_draft": "string or null"
}`;
}

// ============ TWEET PROMPT ============

export const TONE_INSTRUCTIONS: Record<string, string> = {
  casual: 'Relaxed, like texting a friend. Use contractions.',
  pro: 'Professional but not corporate. Clear and confident.',
  tech: 'For developers. Technical terms OK. Concise.',
  hype: 'Energetic but authentic. No cringe.',
};

export function buildTweetPrompt(ctx: {
  name: string;
  oneLiner: string;
  coreValue: string;
  existingTweet?: string;
  tone?: string;
}): string {
  const toneInstruction = ctx.tone ? TONE_INSTRUCTIONS[ctx.tone] || TONE_INSTRUCTIONS.casual : '';
  
  return `${ctx.tone ? `Rewrite this tweet with a ${ctx.tone} tone.` : 'Write a short, punchy tweet to launch this project.'}

Project: ${ctx.name}
What it does: ${ctx.oneLiner}
Core value: ${ctx.coreValue}
${ctx.existingTweet ? `Original: ${ctx.existingTweet}` : ''}

${toneInstruction ? `Tone: ${toneInstruction}` : ''}

Rules: Under 280 chars, no hashtags, no emojis (or one max), sound like a real person.

Just the tweet text.`;
}
