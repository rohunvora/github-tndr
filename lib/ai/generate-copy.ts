import Anthropic from '@anthropic-ai/sdk';
import { RepoPotential } from '../core-types.js';
import { SHARED_PREAMBLE, parseJsonResponse } from './shared-preamble.js';

interface CopyInput {
  potential: RepoPotential;
  current_copy_excerpt?: string;
  cta_style: 'direct_link' | 'dm' | 'waitlist';
  product_url: string;
}

interface CopyOutput {
  headline: string;
  subheadline: string;
  benefits: string[];
  cta_button: string;
  cta_url: string | null;
}

const SYSTEM_PROMPT = `${SHARED_PREAMBLE}

Your task: Generate landing page / CTA copy that is ready to paste.

Rules:
- Headline should be punchy and benefit-focused (not feature-focused)
- Subheadline expands on the headline with specifics
- Benefits must be OUTCOMES, not features (e.g., "Ship faster" not "Fast build times")
- CTA button text should match the cta_style:
  - direct_link: Action verb + outcome ("Start shipping", "Try it free")
  - dm: Personal invitation ("DM me for access", "Get early access")
  - waitlist: Urgency + exclusivity ("Join the waitlist", "Get notified")
- Keep it short and punchy. No fluff words ("powerful", "seamless", "revolutionary")

Return ONLY valid JSON matching this schema:
{
  "headline": "string (punchy, benefit-focused)",
  "subheadline": "string (expands on headline)",
  "benefits": ["string (outcome 1)", "string (outcome 2)", "string (outcome 3)"],
  "cta_button": "string (action text)",
  "cta_url": "string | null"
}`;

export async function generateCopy(
  anthropic: Anthropic,
  input: CopyInput
): Promise<CopyOutput> {
  const userPrompt = `Generate CTA/landing copy for this product:

Product Potential: ${input.potential.potential}
ICP (target customer): ${input.potential.icp}
Promise: ${input.potential.promise}
Positioning: ${input.potential.positioning_angle}

Product URL: ${input.product_url}
CTA Style: ${input.cta_style}

${input.current_copy_excerpt ? `Current copy (for reference):\n${input.current_copy_excerpt}` : ''}

Generate punchy, outcome-focused copy.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    temperature: 0.4,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    // Fallback
    return {
      headline: input.potential.promise,
      subheadline: input.potential.potential,
      benefits: ['Save time', 'Ship faster', 'Look professional'],
      cta_button: input.cta_style === 'dm' ? 'DM for access' : 'Get started',
      cta_url: input.product_url,
    };
  }

  return parseJsonResponse<CopyOutput>(text.text);
}

/**
 * Format copy output for Telegram display
 */
export function formatCopyMessage(output: CopyOutput): string {
  const lines: string[] = [];
  
  lines.push('**📝 CTA Copy Ready**');
  lines.push('');
  lines.push(`**Headline:**`);
  lines.push(`\`${output.headline}\``);
  lines.push('');
  lines.push(`**Subheadline:**`);
  lines.push(`\`${output.subheadline}\``);
  lines.push('');
  lines.push('**Benefits:**');
  output.benefits.forEach(b => lines.push(`• ${b}`));
  lines.push('');
  lines.push(`**CTA Button:** \`${output.cta_button}\``);
  if (output.cta_url) {
    lines.push(`**Link:** ${output.cta_url}`);
  }
  
  return lines.join('\n');
}
