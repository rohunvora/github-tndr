import Anthropic from '@anthropic-ai/sdk';
import { RepoPotential, RepoPotentialOutputSchema } from '../core/types.js';
import { SHARED_PREAMBLE, wrapUntrustedContent, parseJsonResponse } from './shared-preamble.js';
import { AI_MODEL } from '../core/config.js';

const PROMPT_VERSION = 'repoPotential_v1';

interface RepoPotentialInput {
  repo_name: string;
  repo_description: string;
  readme_excerpt: string;
  tech_stack: string[];
  known_audience_context?: string;
}

const SYSTEM_PROMPT = `${SHARED_PREAMBLE}

Your task: Write an aspirational but plausible one-liner for what this repo COULD be.

Rules:
- The "potential" must be tweetable (under 100 chars)
- Must not claim features that are not evidenced in the inputs
- If the purpose is unclear, keep it generic and mark confidence "low"
- ICP (Ideal Customer Profile) should be specific: "indie hackers building SaaS" not "developers"
- Promise should be a concrete outcome, not a vague benefit

Return ONLY valid JSON matching this schema:
{
  "potential": "string (under 100 chars, aspirational one-liner)",
  "icp": "string (specific ideal customer profile)",
  "promise": "string (concrete outcome they get)",
  "positioning_angle": "string (what makes this different)",
  "confidence": "high" | "medium" | "low",
  "prompt_version": "${PROMPT_VERSION}"
}`;

export async function generateRepoPotential(
  anthropic: Anthropic,
  input: RepoPotentialInput
): Promise<RepoPotential> {
  const userPrompt = `Analyze this repo and generate its potential:

Repo Name: ${input.repo_name}
Description: ${input.repo_description || '(none)'}
Tech Stack: ${input.tech_stack.length > 0 ? input.tech_stack.join(', ') : '(unknown)'}
${input.known_audience_context ? `Audience Context: ${input.known_audience_context}` : ''}

README (first 2000 chars):
${wrapUntrustedContent(input.readme_excerpt || '(No README)')}

Generate the aspirational potential for this repo.`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 500,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  const parsed = parseJsonResponse<RepoPotential>(text.text);
  
  // Validate with zod
  const validated = RepoPotentialOutputSchema.parse({
    ...parsed,
    prompt_version: PROMPT_VERSION,
  });

  return validated;
}
