import Anthropic from '@anthropic-ai/sdk';
import { RepoPotential } from '../core-types.js';
import { SHARED_PREAMBLE, parseJsonResponse } from './shared-preamble.js';

interface LaunchPostInput {
  potential: RepoPotential;
  product_url: string;
  screenshot_url?: string;
  user_voice_samples?: string[];  // 3-5 past posts for voice matching
  platform: 'x' | 'newsletter' | 'linkedin';
}

interface LaunchPostOutput {
  platform: string;
  post: string;
  alt_versions: string[];
  cta: string;
}

const SYSTEM_PROMPT = `${SHARED_PREAMBLE}

Your task: Write a launch post that sounds like the user, not generic AI copy.

Rules:
- Keep it SHORT. X posts should be under 280 chars. LinkedIn under 500.
- Include the product URL
- Must have a clear CTA (try it, check it out, etc.)
- Be specific about what it does - no vague hype
- If voice samples are provided, match that tone/style
- Provide 2 alternate versions with different angles:
  - One focusing on the benefit/outcome
  - One with a story/problem angle

Return ONLY valid JSON matching this schema:
{
  "platform": "x" | "newsletter" | "linkedin",
  "post": "string (the main post)",
  "alt_versions": ["string (benefit angle)", "string (story angle)"],
  "cta": "string (the call to action phrase)"
}`;

export async function generateLaunchPost(
  anthropic: Anthropic,
  input: LaunchPostInput
): Promise<LaunchPostOutput> {
  const platformGuidance = {
    x: 'Keep under 280 characters. Punchy. No hashtags unless very relevant.',
    newsletter: 'Can be longer. More context. Personal tone.',
    linkedin: 'Professional but not corporate. Can include backstory. Under 500 chars.',
  };

  const userPrompt = `Write a launch post for this product:

Product: ${input.potential.potential}
ICP: ${input.potential.icp}
Promise: ${input.potential.promise}
Positioning: ${input.potential.positioning_angle}

URL: ${input.product_url}
Platform: ${input.platform}
${platformGuidance[input.platform]}

${input.screenshot_url ? `Screenshot: ${input.screenshot_url}` : ''}

${input.user_voice_samples && input.user_voice_samples.length > 0 
  ? `Voice samples (match this tone):\n${input.user_voice_samples.map((s, i) => `${i + 1}. "${s}"`).join('\n')}`
  : 'Use a casual, direct tone. No corporate speak.'}

Write the launch post and 2 alternate versions.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    temperature: 0.6,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    // Fallback
    const shortPost = input.platform === 'x' 
      ? `Just shipped: ${input.potential.potential}\n\n${input.product_url}`
      : `Excited to share what I've been working on: ${input.potential.potential}\n\nCheck it out: ${input.product_url}`;
    
    return {
      platform: input.platform,
      post: shortPost,
      alt_versions: [
        `${input.potential.promise}\n\n${input.product_url}`,
        `Built this to solve ${input.potential.icp}'s problem.\n\n${input.product_url}`,
      ],
      cta: 'Check it out',
    };
  }

  return parseJsonResponse<LaunchPostOutput>(text.text);
}

/**
 * Format launch post output for Telegram display
 */
export function formatLaunchPostMessage(output: LaunchPostOutput): string {
  const lines: string[] = [];
  
  const platformEmoji = {
    x: '🐦',
    newsletter: '📧',
    linkedin: '💼',
  }[output.platform] || '📝';
  
  lines.push(`**${platformEmoji} Launch Post Ready**`);
  lines.push('');
  lines.push('**Main version:**');
  lines.push('```');
  lines.push(output.post);
  lines.push('```');
  lines.push('');
  
  if (output.alt_versions.length > 0) {
    lines.push('**Alternate versions:**');
    output.alt_versions.forEach((v, i) => {
      lines.push(`_Version ${i + 2}:_`);
      lines.push('```');
      lines.push(v);
      lines.push('```');
    });
  }
  
  lines.push('');
  lines.push(`**CTA:** ${output.cta}`);
  
  return lines.join('\n');
}
