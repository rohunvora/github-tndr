import Anthropic from '@anthropic-ai/sdk';
import { WhatChangedOutputSchema } from '../core/types.js';
import { SHARED_PREAMBLE, parseJsonResponse } from './shared-preamble.js';
import { AI_MODEL } from '../core/config.js';

interface WhatChangedInput {
  commit_sha: string;
  commit_message: string;
  files_changed: string[];
  diff_excerpt?: string;
  previous_next_step?: string;
}

interface WhatChangedOutput {
  what_changed: string;
  matches_expected: 'yes' | 'no' | 'unknown';
}

const SYSTEM_PROMPT = `${SHARED_PREAMBLE}

Your task: Summarize what changed in ONE sentence.

Rules:
- Be specific ("Added CTA button to landing page") not vague ("Made some changes")
- If a previous_next_step is provided, judge whether the change matches the expected work
- Do not overclaim - if unclear, set matches_expected to "unknown"

Return ONLY valid JSON matching this schema:
{
  "what_changed": "string (1 sentence summary)",
  "matches_expected": "yes" | "no" | "unknown"
}`;

export async function generateWhatChanged(
  anthropic: Anthropic,
  input: WhatChangedInput
): Promise<WhatChangedOutput> {
  // Simple case: use commit message if it's clear
  const commitMsg = input.commit_message.split('\n')[0];
  if (commitMsg.length > 20 && commitMsg.length < 100 && !commitMsg.toLowerCase().includes('wip')) {
    // Commit message is probably descriptive enough
    const matchesExpected = input.previous_next_step
      ? (commitMsg.toLowerCase().includes(input.previous_next_step.toLowerCase().slice(0, 20)) ? 'yes' : 'unknown')
      : 'unknown';
    
    return {
      what_changed: commitMsg,
      matches_expected: matchesExpected as 'yes' | 'no' | 'unknown',
    };
  }

  // Need LLM to summarize
  const userPrompt = `Summarize what changed in this commit:

Commit: ${input.commit_sha.slice(0, 7)}
Message: ${input.commit_message}

Files changed:
${input.files_changed.slice(0, 10).map(f => `- ${f}`).join('\n')}
${input.files_changed.length > 10 ? `... and ${input.files_changed.length - 10} more` : ''}

${input.diff_excerpt ? `Diff excerpt:\n${input.diff_excerpt.slice(0, 500)}` : ''}

${input.previous_next_step ? `Expected work: ${input.previous_next_step}` : ''}

Summarize in 1 sentence.`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 200,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    // Fallback
    return {
      what_changed: commitMsg || 'Made changes',
      matches_expected: 'unknown',
    };
  }

  const parsed = parseJsonResponse<WhatChangedOutput>(text.text);
  return WhatChangedOutputSchema.parse(parsed);
}
