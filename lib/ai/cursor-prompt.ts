import Anthropic from '@anthropic-ai/sdk';
import { CursorPromptOutputSchema } from '../core-types.js';
import { SHARED_PREAMBLE, wrapUntrustedContent, parseJsonResponse } from './shared-preamble.js';
import { AI_MODEL } from '../config.js';

interface CursorPromptInput {
  repo_name: string;
  next_step_action: string;
  target_files_candidates: string[];
  relevant_snippets?: string[];
  readme_excerpt?: string;
}

interface CursorPromptOutput {
  title: string;
  cursor_prompt: string;
  target_files: string[];
  acceptance_criteria: string[];
}

const SYSTEM_PROMPT = `${SHARED_PREAMBLE}

Your task: Write a Cursor prompt that is copy-paste ready for the user's next step.

Rules:
- Mention specific target files (from the candidates provided, do NOT invent file paths)
- Include 3-7 acceptance criteria as checkboxes
- Scope to 30-90 minutes of work
- Reference any provided evidence (snippets, context) explicitly
- The prompt should be actionable and specific, not vague

Return ONLY valid JSON matching this schema:
{
  "title": "string (short title for the task)",
  "cursor_prompt": "string (the full prompt, plain text, no markdown)",
  "target_files": ["string (file paths to modify)"],
  "acceptance_criteria": ["string (checkbox items)"]
}`;

export async function generateCursorPromptArtifact(
  anthropic: Anthropic,
  input: CursorPromptInput
): Promise<CursorPromptOutput> {
  const userPrompt = `Generate a Cursor prompt for this task:

Repository: ${input.repo_name}
Task: ${input.next_step_action}

Available files to modify:
${input.target_files_candidates.slice(0, 20).map(f => `- ${f}`).join('\n')}

${input.relevant_snippets && input.relevant_snippets.length > 0 
  ? `Relevant code snippets:\n${input.relevant_snippets.map(s => wrapUntrustedContent(s)).join('\n\n')}`
  : ''}

${input.readme_excerpt 
  ? `README context:\n${wrapUntrustedContent(input.readme_excerpt.slice(0, 1000))}`
  : ''}

Generate a specific, actionable Cursor prompt for this task.`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1000,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    // Fallback to a basic prompt
    return {
      title: input.next_step_action,
      cursor_prompt: `Task: ${input.next_step_action}\n\nPlease implement this change in the ${input.repo_name} repository.\n\nTarget files: ${input.target_files_candidates.slice(0, 3).join(', ')}\n\nAcceptance criteria:\n- [ ] Change is implemented\n- [ ] Code compiles without errors\n- [ ] Basic functionality works`,
      target_files: input.target_files_candidates.slice(0, 3),
      acceptance_criteria: [
        'Change is implemented',
        'Code compiles without errors',
        'Basic functionality works',
      ],
    };
  }

  const parsed = parseJsonResponse<CursorPromptOutput>(text.text);
  return CursorPromptOutputSchema.parse(parsed);
}

/**
 * Format the cursor prompt for Telegram display
 */
export function formatCursorPromptMessage(output: CursorPromptOutput): string {
  const lines: string[] = [];
  
  lines.push(`**${output.title}**`);
  lines.push('');
  lines.push('```');
  lines.push(output.cursor_prompt);
  lines.push('```');
  lines.push('');
  lines.push('**Target files:**');
  output.target_files.forEach(f => lines.push(`• \`${f}\``));
  lines.push('');
  lines.push('**Acceptance criteria:**');
  output.acceptance_criteria.forEach(c => lines.push(`☐ ${c}`));
  
  return lines.join('\n');
}
