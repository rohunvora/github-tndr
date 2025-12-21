import Anthropic from '@anthropic-ai/sdk';
import { RepoCard, ProjectStage } from '../core/types.js';
import { SHARED_PREAMBLE, parseJsonResponse } from './shared-preamble.js';
import { AI_MODEL } from '../core/config.js';

interface DeepDiveInput {
  repo_card: RepoCard;
  readme_excerpt?: string;
  file_tree?: string[];
}

interface DeepDiveOutput {
  summary: string;
  stage: ProjectStage;
  top_next_steps: Array<{
    label: string;
    action: string;
    artifact_type: 'cursor_prompt' | 'copy' | 'checklist' | 'launch_post';
  }>;
  blockers: string[];
}

const SYSTEM_PROMPT = `${SHARED_PREAMBLE}

Your task: Create a deep dive that restores context quickly and provides 3 actionable next steps.

Rules:
- Summary should be 1-2 sentences capturing current state
- Provide EXACTLY 3 next steps, ordered by leverage (highest first)
- Each step must have an artifact type that can be generated with one tap
- Blockers should only list actual blocking issues, not suggestions
- Be specific and last-10%-oriented - no vague advice

Return ONLY valid JSON matching this schema:
{
  "summary": "string (1-2 sentences)",
  "stage": "building" | "packaging" | "ready_to_launch" | "post_launch",
  "top_next_steps": [
    {"label": "string", "action": "string", "artifact_type": "cursor_prompt" | "copy" | "checklist" | "launch_post"},
    {"label": "string", "action": "string", "artifact_type": "..."},
    {"label": "string", "action": "string", "artifact_type": "..."}
  ],
  "blockers": ["string"] // empty if none
}`;

export async function generateDeepDive(
  anthropic: Anthropic,
  input: DeepDiveInput
): Promise<DeepDiveOutput> {
  const card = input.repo_card;
  
  const userPrompt = `Generate a deep dive for this project:

**${card.repo}**
Stage: ${card.stage}
Potential: ${card.potential.potential}
ICP: ${card.potential.icp}
Promise: ${card.potential.promise}

Last context: ${card.last_context.last_context}
Current next step: ${card.next_step.action}
Current step source: ${card.next_step.source}

${input.readme_excerpt ? `README excerpt:\n${input.readme_excerpt.slice(0, 1000)}` : ''}

${input.file_tree && input.file_tree.length > 0 
  ? `Key files:\n${input.file_tree.slice(0, 15).join('\n')}`
  : ''}

Provide a summary and exactly 3 next steps ordered by leverage.`;

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 600,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    // Fallback based on current card
    return {
      summary: `${card.repo} is in ${card.stage} stage. ${card.last_context.last_context}`,
      stage: card.stage,
      top_next_steps: [
        {
          label: 'Primary',
          action: card.next_step.action,
          artifact_type: card.next_step.artifact.type === 'none' ? 'cursor_prompt' : card.next_step.artifact.type as 'cursor_prompt' | 'copy' | 'checklist' | 'launch_post',
        },
        {
          label: 'Documentation',
          action: 'Improve README with clear value prop',
          artifact_type: 'copy',
        },
        {
          label: 'Polish',
          action: 'Add error handling and edge cases',
          artifact_type: 'cursor_prompt',
        },
      ],
      blockers: [],
    };
  }

  return parseJsonResponse<DeepDiveOutput>(text.text);
}

/**
 * Format deep dive for Telegram (enhanced version)
 */
export function formatDeepDiveMessage(output: DeepDiveOutput, repoName: string, deployUrl: string | null): string {
  const lines: string[] = [];
  
  const stageEmoji = {
    building: '🔨',
    packaging: '📦',
    ready_to_launch: '🚀',
    post_launch: '🏆',
  }[output.stage] || '📋';
  
  lines.push(`**${repoName}** — Deep Dive`);
  lines.push('');
  lines.push(`${stageEmoji} **Stage:** ${output.stage.replace('_', ' ')}`);
  if (deployUrl) {
    lines.push(`🔗 **Live:** ${deployUrl}`);
  }
  lines.push('');
  lines.push(`**Summary:** ${output.summary}`);
  lines.push('');
  lines.push('**Next Steps (by leverage):**');
  output.top_next_steps.forEach((step, i) => {
    const artifactIcon = {
      cursor_prompt: '💻',
      copy: '📝',
      checklist: '☑️',
      launch_post: '📢',
    }[step.artifact_type] || '•';
    lines.push(`${i + 1}. ${artifactIcon} ${step.action}`);
  });
  
  if (output.blockers.length > 0) {
    lines.push('');
    lines.push('**⚠️ Blockers:**');
    output.blockers.forEach(b => lines.push(`• ${b}`));
  }
  
  return lines.join('\n');
}
