import { z } from 'zod';

// ============ REPO STATE ============

export type RepoState =
  | 'unanalyzed'
  | 'analyzing'
  | 'dead'
  | 'no_core'
  | 'has_core'
  | 'ready'
  | 'shipped';

export type Verdict = 'ship' | 'cut_to_core' | 'no_core' | 'dead';

// ============ PROJECT STAGE (for feed) ============

export type ProjectStage = 'building' | 'packaging' | 'ready_to_launch' | 'post_launch';

// ============ FEED TYPES ============

export interface RepoPotential {
  potential: string;      // Aspirational one-liner (tweetable)
  icp: string;            // Ideal customer profile
  promise: string;        // Concrete outcome
  positioning_angle: string;
  confidence: 'high' | 'medium' | 'low';
  prompt_version: string;
}

export interface LastContext {
  last_context: string;   // 1 sentence summary
  last_work_order_status: 'open' | 'done' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

export type NextStepSource = 'readme_todo' | 'user_stated' | 'deploy_state' | 'commit_gap' | 'ai_inferred';
export type ArtifactType = 'cursor_prompt' | 'copy' | 'checklist' | 'command' | 'launch_post' | 'none';

export interface NextStep {
  action: string;
  source: NextStepSource;
  artifact: {
    type: ArtifactType;
    reason: string;
  };
  why_this_now: string;
  blocking_question: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface RepoCard {
  repo: string;
  full_name: string;
  cover_image_url: string;
  homepage: string | null;  // GitHub homepage field - used for [live] link
  potential: RepoPotential;
  last_context: LastContext;
  next_step: NextStep;
  priority_score: number;
  stage: ProjectStage;
}

export interface FeedMemory {
  shown_today: string[];           // repo full_names
  skipped_today: string[];
  active_card: string | null;      // current repo being worked on
  last_reset: string;              // ISO date for daily reset
  intentions: Record<string, {
    action: string;
    stated_at: string;
    remind_after: string;
  }>;
}

export interface DeployState {
  status: 'green' | 'red' | 'unknown';
  url?: string;
  error_excerpt?: string;
}

export interface PackagingChecks {
  has_clear_cta: boolean;
  has_demo_asset: boolean;
  has_readme_image: boolean;
}

// ============ AI FUNCTION INPUT/OUTPUT SCHEMAS ============

export const RepoPotentialInputSchema = z.object({
  repo_name: z.string(),
  repo_description: z.string(),
  readme_excerpt: z.string(),
  tech_stack: z.array(z.string()),
  known_audience_context: z.string().optional(),
});

export const RepoPotentialOutputSchema = z.object({
  potential: z.string(),
  icp: z.string(),
  promise: z.string(),
  positioning_angle: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  prompt_version: z.string(),
});

export const LastContextInputSchema = z.object({
  recent_commits: z.array(z.object({
    sha: z.string(),
    message: z.string(),
    files_changed: z.array(z.string()),
  })),
  last_bot_interaction: z.string().optional(),
  open_intention: z.object({
    action: z.string(),
    stated_at: z.string(),
  }).optional(),
});

export const LastContextOutputSchema = z.object({
  last_context: z.string(),
  last_work_order_status: z.enum(['open', 'done', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const NextStepInputSchema = z.object({
  readme_todos: z.array(z.string()),
  stated_intention: z.object({ action: z.string() }).optional(),
  deploy_state: z.object({
    status: z.enum(['green', 'red', 'unknown']),
    url: z.string().optional(),
    error_excerpt: z.string().optional(),
  }),
  packaging_checks: z.object({
    has_clear_cta: z.boolean(),
    has_demo_asset: z.boolean(),
    has_readme_image: z.boolean(),
  }),
  project_stage: z.enum(['building', 'packaging', 'ready_to_launch', 'post_launch']),
  recent_activity_summary: z.string(),
  potential: RepoPotentialOutputSchema,
});

export const NextStepOutputSchema = z.object({
  next_step: z.object({
    action: z.string(),
    source: z.enum(['readme_todo', 'user_stated', 'deploy_state', 'commit_gap', 'ai_inferred']),
    artifact: z.object({
      type: z.enum(['cursor_prompt', 'copy', 'checklist', 'command', 'launch_post', 'none']),
      reason: z.string(),
    }),
  }),
  why_this_now: z.string(),
  blocking_question: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const CursorPromptOutputSchema = z.object({
  title: z.string(),
  cursor_prompt: z.string(),
  target_files: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
});

export const WhatChangedOutputSchema = z.object({
  what_changed: z.string(),
  matches_expected: z.enum(['yes', 'no', 'unknown']),
});

// ============ EVIDENCE TYPES (for grounded analysis) ============

export interface CoreEvidence {
  file: string;
  symbols: string[];
  reason: string;
}

export interface MismatchEvidence {
  readme_section: string;
  code_anchor: string;  // file:symbol format
  conflict: string;
}

export interface ReadmeClaim {
  claim: string;
  support: 'supported' | 'partial' | 'unsupported' | 'unknown';
  evidence: string[];  // file:symbol references
}

export type PrideLevel = 'proud' | 'comfortable' | 'neutral' | 'embarrassed';
export type DemoArtifact = 'screenshot' | 'gif' | 'cli_output' | 'metric' | 'api_example' | null;

// Zod schemas for evidence types
export const CoreEvidenceSchema = z.object({
  file: z.string(),
  symbols: z.array(z.string()),
  reason: z.string(),
});

export const MismatchEvidenceSchema = z.object({
  readme_section: z.string(),
  code_anchor: z.string(),
  conflict: z.string(),
});

export const ReadmeClaimSchema = z.object({
  claim: z.string(),
  support: z.enum(['supported', 'partial', 'unsupported', 'unknown']),
  evidence: z.array(z.string()),
});

// ============ CORE ANALYSIS (LLM Output) ============

export const CoreAnalysisSchema = z.object({
  // Basic identification
  one_liner: z.string().max(140),
  code_one_liner: z.string().max(100).optional().default(''), // Code-derived, not README-ish
  what_it_does: z.string(),
  
  // Core determination
  has_core: z.boolean(),
  core_value: z.string().nullable(),
  why_core: z.string().nullable(),
  
  // Evidence-anchored fields (optional with defaults for backwards compat)
  core_evidence: z.array(CoreEvidenceSchema).optional().default([]),
  readme_claims: z.array(ReadmeClaimSchema).optional().default([]),
  mismatch_evidence: z.array(MismatchEvidenceSchema).optional().default([]),
  
  // Keep/cut lists
  keep: z.array(z.string()),
  cut: z.array(z.string()),
  
  // Verdict
  verdict: z.enum(['ship', 'cut_to_core', 'no_core', 'dead']),
  verdict_reason: z.string(),
  
  // Demo/shareability (optional with defaults)
  demo_command: z.string().nullable().optional().default(null),
  demo_artifact: z.enum(['screenshot', 'gif', 'cli_output', 'metric', 'api_example']).nullable().optional().default(null),
  shareable_angle: z.string().nullable().optional().default(null),
  
  // Objective pride (optional with defaults)
  pride_level: z.enum(['proud', 'comfortable', 'neutral', 'embarrassed']).optional().default('neutral'),
  pride_blockers: z.array(z.string()).optional().default([]),
  
  // Tweet only if proud
  tweet_draft: z.string().max(280).nullable(),
});

export type CoreAnalysis = z.infer<typeof CoreAnalysisSchema>;

// ============ TRACKED REPO ============

export interface TrackedRepo {
  id: string;
  name: string;
  owner: string;
  state: RepoState;
  analysis: CoreAnalysis | null;
  analyzed_at: string | null;
  pending_action: 'cut_to_core' | 'ship' | null;
  pending_since: string | null;
  last_message_id: number | null;
  last_push_at: string | null;
  killed_at: string | null;
  shipped_at: string | null;
  cover_image_url: string | null;
  homepage: string | null;  // GitHub homepage field for deploy URL
}

// ============ VALIDATION ============

export function validateAnalysis(analysis: CoreAnalysis, fileTree: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check keep/cut disjoint
  const keepSet = new Set(analysis.keep);
  const overlap = analysis.cut.filter(f => keepSet.has(f));
  if (overlap.length > 0) {
    errors.push(`Files in both keep and cut: ${overlap.join(', ')}`);
  }

  // Check verdict consistency
  if (!analysis.has_core && !['no_core', 'dead'].includes(analysis.verdict)) {
    errors.push(`No core but verdict is ${analysis.verdict}`);
  }
  if (analysis.verdict === 'ship' && (!analysis.has_core || !analysis.core_value)) {
    errors.push('Ship verdict requires has_core and core_value');
  }

  // Check evidence requirements (NEW)
  if (analysis.has_core && analysis.core_evidence.length < 2) {
    errors.push(`Core claims require at least 2 evidence entries, got ${analysis.core_evidence.length}`);
  }
  
  // Verify evidence has valid file references
  for (const evidence of analysis.core_evidence) {
    if (!evidence.file || evidence.symbols.length === 0) {
      errors.push(`Evidence entry missing file or symbols: ${JSON.stringify(evidence)}`);
    }
  }
  
  // Verify mismatch evidence has both sides
  for (const mismatch of analysis.mismatch_evidence) {
    if (!mismatch.readme_section || !mismatch.code_anchor) {
      errors.push(`Mismatch evidence missing readme_section or code_anchor: ${JSON.stringify(mismatch)}`);
    }
  }

  // Check tweet is only present when proud (NEW)
  if (analysis.tweet_draft && analysis.pride_level !== 'proud') {
    errors.push(`Tweet draft present but pride_level is ${analysis.pride_level}, not 'proud'`);
  }

  // Check tweet length
  if (analysis.tweet_draft && analysis.tweet_draft.length > 280) {
    errors.push(`Tweet too long: ${analysis.tweet_draft.length} chars`);
  }
  
  // Check pride_blockers consistency (NEW)
  if (analysis.pride_level === 'proud' && analysis.pride_blockers.length > 0) {
    errors.push(`Pride level is 'proud' but blockers exist: ${analysis.pride_blockers.join(', ')}`);
  }
  if (analysis.pride_level !== 'proud' && analysis.pride_blockers.length === 0) {
    errors.push(`Pride level is '${analysis.pride_level}' but no blockers specified`);
  }

  return { valid: errors.length === 0, errors };
}
