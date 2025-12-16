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

// ============ COVER IMAGE PROMPT ============

import { TrackedRepo } from './core-types.js';

// Expert-optimized Visual Constitution for Gemini 3 Pro Image (Nano Banana Pro)
const VISUAL_CONSTITUTION = `
ROLE: You are a UI/UX Designer creating a product screenshot for a landing page.
OBJECTIVE: Show the ACTUAL INTERFACE of the product, not a photo of someone using it.

CRITICAL: DO NOT GENERATE:
- Laptops, monitors, or computer screens showing the product
- Stock photo style images with people or hands
- "Marketing shots" or "product photography"
- 3D renders of devices (unless it's a mobile app)

WHAT TO GENERATE:
- The UI itself, floating on a clean background
- A direct screenshot-style view of the interface
- Clean, flat design with subtle shadows

THE 3 VISUAL MODES:

1. MODE A: "TERMINAL" (CLI, DevTools, Libraries, APIs)
   - Show: A terminal window or code editor pane, floating
   - Background: Dark charcoal or navy, matte
   - Style: Monospace font, syntax highlighting, clean borders
   - NO laptops. Just the terminal window itself.

2. MODE B: "MOBILE" (Apps, Chat, Social, Consumer)
   - Show: iPhone frame with the app UI inside
   - Background: Solid vibrant color (lime green, hot pink, electric blue)
   - Style: High contrast, the phone is the hero
   - This is the ONLY mode where a device frame is acceptable.

3. MODE C: "DASHBOARD" (SaaS, Web Apps, Analytics, B2B)
   - Show: Browser window or UI cards floating, NO laptop around it
   - Background: Off-white, cream, or soft gradient
   - Style: Rounded corners, soft shadows, plenty of whitespace
   - Like Stripe/Linear marketing - just the UI, not a photo of it.

MANDATORY:
1. Show the product WORKING with real-looking data
2. The product name must appear as text in the image
3. NO STOCK PHOTO AESTHETICS - this should look like a UI screenshot, not a photo
`;

export function buildCoverPrompt(repo: TrackedRepo): { prompt: string; aspectRatio: string } {
  const a = repo.analysis;
  if (!a) {
    throw new Error('Cannot generate cover without analysis');
  }

  // Determine mode and aspect ratio based on product type
  const whatItDoes = a.what_it_does.toLowerCase();
  let mode: 'terminal' | 'mobile' | 'dashboard' = 'dashboard';
  let aspectRatio = '16:9';

  if (whatItDoes.includes('cli') || whatItDoes.includes('terminal') || whatItDoes.includes('library') || whatItDoes.includes('api') || whatItDoes.includes('script')) {
    mode = 'terminal';
    aspectRatio = '16:9';
  } else if (whatItDoes.includes('mobile') || whatItDoes.includes('ios') || whatItDoes.includes('android') || whatItDoes.includes('app')) {
    mode = 'mobile';
    aspectRatio = '9:16';
  }

  const prompt = `
${VISUAL_CONSTITUTION}

PRODUCT: "${repo.name}"
WHAT IT DOES: ${a.what_it_does}
CORE VALUE: ${a.core_value}

SELECTED MODE: ${mode.toUpperCase()}

Generate a UI screenshot for "${repo.name}".

${mode === 'terminal' ? `
Show a floating terminal/code editor window on a dark matte background.
Inside the terminal, show realistic output that demonstrates: ${a.core_value}
Example: command prompts, success messages, code snippets.
` : ''}

${mode === 'mobile' ? `
Show an iPhone with the app UI on screen.
Place it on a solid vibrant background (lime green, electric blue, or hot pink).
The UI should show: ${a.core_value}
` : ''}

${mode === 'dashboard' ? `
Show the web UI floating on an off-white/cream background. NO LAPTOP.
Just the browser window or UI cards with soft shadows.
The interface should display: ${a.core_value}
Style: Clean, minimal, like Stripe or Linear marketing screenshots.
` : ''}

IMPORTANT:
- Include the text "${repo.name}" somewhere visible in the image
- Show realistic data, not placeholder text
- This should look like a REAL PRODUCT SCREENSHOT, not a stock photo
`;

  return { prompt, aspectRatio };
}
