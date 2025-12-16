import Anthropic from '@anthropic-ai/sdk';
import { NextStep, NextStepOutputSchema, RepoPotential, DeployState, PackagingChecks, ProjectStage } from '../core-types.js';
import { SHARED_PREAMBLE, parseJsonResponse } from './shared-preamble.js';

interface NextStepInput {
  readme_todos: string[];
  stated_intention?: { action: string };
  deploy_state: DeployState;
  packaging_checks: PackagingChecks;
  project_stage: ProjectStage;
  recent_activity_summary: string;
  potential: RepoPotential;
}

const SYSTEM_PROMPT = `${SHARED_PREAMBLE}

Your task: Choose exactly ONE next step that moves the project toward shipping.

Priority order (FOLLOW THIS STRICTLY):
1) If deploy is failing (status="red") -> next step is to fix deploy. Source: "deploy_state". Artifact: "cursor_prompt".
2) Else if user has a confirmed intention -> next step aligns to it. Source: "user_stated".
3) Else if stage="ready_to_launch" -> next step is launch. Source: "ai_inferred". Artifact: "launch_post".
4) Else if stage="packaging" -> pick the single highest leverage packaging gap:
   - No CTA? -> Add CTA. Artifact: "copy"
   - No demo asset? -> Add screenshot/demo. Artifact: "cursor_prompt"
   - No README image? -> Add cover image. Artifact: "cursor_prompt"
5) Else if readme_todos exist -> use first TODO. Source: "readme_todo".
6) Else -> infer from commit gaps. Source: "commit_gap" or "ai_inferred".

Rules:
- Return EXACTLY ONE next step
- If you're missing inputs needed to choose confidently, set blocking_question to ONE specific question
- The artifact type should make the action one-tap executable:
  - Code changes -> "cursor_prompt"
  - Copy/text -> "copy"
  - Launch announcement -> "launch_post"
  - Environment/config -> "checklist"
  - Simple command -> "command"
  - Unclear -> "none"

Return ONLY valid JSON matching this schema:
{
  "next_step": {
    "action": "string (specific action, e.g., 'Add CTA to landing page')",
    "source": "readme_todo" | "user_stated" | "deploy_state" | "commit_gap" | "ai_inferred",
    "artifact": {
      "type": "cursor_prompt" | "copy" | "checklist" | "command" | "launch_post" | "none",
      "reason": "string (why this artifact type)"
    }
  },
  "why_this_now": "string (brief explanation)",
  "blocking_question": "string | null",
  "confidence": "high" | "medium" | "low"
}`;

export async function generateNextStep(
  anthropic: Anthropic,
  input: NextStepInput
): Promise<NextStep> {
  // Deterministic fast-paths (no LLM needed)
  
  // 1. Deploy is failing - highest priority
  if (input.deploy_state.status === 'red') {
    return {
      action: 'Fix failing deploy',
      source: 'deploy_state',
      artifact: {
        type: 'cursor_prompt',
        reason: 'Deploy is red - need code fix',
      },
      why_this_now: input.deploy_state.error_excerpt 
        ? `Deploy failing: ${input.deploy_state.error_excerpt.slice(0, 100)}`
        : 'Deploy is failing and needs immediate attention',
      blocking_question: null,
      confidence: 'high',
    };
  }

  // 2. User stated intention
  if (input.stated_intention) {
    return {
      action: input.stated_intention.action,
      source: 'user_stated',
      artifact: {
        type: 'cursor_prompt', // Default to cursor prompt for stated intentions
        reason: 'User committed to this action',
      },
      why_this_now: 'You said you would do this',
      blocking_question: null,
      confidence: 'high',
    };
  }

  // 3. Ready to launch - ship it
  if (input.project_stage === 'ready_to_launch') {
    return {
      action: 'Write launch post and ship it',
      source: 'ai_inferred',
      artifact: {
        type: 'launch_post',
        reason: 'Project is ready - time to announce',
      },
      why_this_now: 'All packaging checks passed - ready to launch',
      blocking_question: null,
      confidence: 'high',
    };
  }

  // 4. Packaging stage - find the gap
  if (input.project_stage === 'packaging') {
    if (!input.packaging_checks.has_clear_cta) {
      return {
        action: 'Add clear CTA to landing page',
        source: 'ai_inferred',
        artifact: {
          type: 'copy',
          reason: 'Need compelling CTA copy',
        },
        why_this_now: 'Missing CTA - visitors have no clear action to take',
        blocking_question: null,
        confidence: 'high',
      };
    }
    if (!input.packaging_checks.has_demo_asset) {
      return {
        action: 'Add demo screenshot or video',
        source: 'ai_inferred',
        artifact: {
          type: 'cursor_prompt',
          reason: 'Need visual demo of the product',
        },
        why_this_now: 'No demo asset - people need to see it working',
        blocking_question: null,
        confidence: 'high',
      };
    }
    if (!input.packaging_checks.has_readme_image) {
      return {
        action: 'Add cover image to README',
        source: 'ai_inferred',
        artifact: {
          type: 'cursor_prompt',
          reason: 'README needs visual appeal',
        },
        why_this_now: 'README has no image - first impressions matter',
        blocking_question: null,
        confidence: 'medium',
      };
    }
  }

  // 5. README TODOs exist
  if (input.readme_todos.length > 0) {
    const firstTodo = input.readme_todos[0];
    return {
      action: firstTodo,
      source: 'readme_todo',
      artifact: {
        type: 'cursor_prompt',
        reason: 'TODO from README',
      },
      why_this_now: 'First TODO in your list',
      blocking_question: null,
      confidence: 'high',
    };
  }

  // 6. LLM inference for complex cases
  const userPrompt = `Determine the single most important next step for this project:

Project Potential: ${input.potential.potential}
ICP: ${input.potential.icp}
Promise: ${input.potential.promise}

Current Stage: ${input.project_stage}
Deploy Status: ${input.deploy_state.status}${input.deploy_state.url ? ` (${input.deploy_state.url})` : ''}

Packaging Status:
- Has CTA: ${input.packaging_checks.has_clear_cta}
- Has Demo: ${input.packaging_checks.has_demo_asset}
- Has README Image: ${input.packaging_checks.has_readme_image}

Recent Activity: ${input.recent_activity_summary}

README TODOs: ${input.readme_todos.length > 0 ? input.readme_todos.join(', ') : '(none)'}

What is the single highest-leverage next step to ship this?`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    // Fallback
    return {
      action: 'Review and improve the project',
      source: 'ai_inferred',
      artifact: { type: 'none', reason: 'No specific artifact needed' },
      why_this_now: 'General improvement needed',
      blocking_question: 'What specific aspect needs work?',
      confidence: 'low',
    };
  }

  const parsed = parseJsonResponse<{ next_step: NextStep['artifact'] & { action: string; source: NextStep['source'] }; why_this_now: string; blocking_question: string | null; confidence: 'high' | 'medium' | 'low' }>(text.text);
  const validated = NextStepOutputSchema.parse(parsed);
  
  return {
    action: validated.next_step.action,
    source: validated.next_step.source,
    artifact: validated.next_step.artifact,
    why_this_now: validated.why_this_now,
    blocking_question: validated.blocking_question,
    confidence: validated.confidence,
  };
}
