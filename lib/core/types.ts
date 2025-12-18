/**
 * Core Types
 * Shared type definitions used across all tools
 */

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

// ============ PROJECT STAGE ============

export type ProjectStage = 'building' | 'packaging' | 'ready_to_launch' | 'post_launch';

// ============ EVIDENCE TYPES ============

export interface CoreEvidence {
  file: string;
  symbols: string[];
  reason: string;
}

export interface MismatchEvidence {
  readme_section: string;
  code_anchor: string;
  conflict: string;
}

export interface ReadmeClaim {
  claim: string;
  support: 'supported' | 'partial' | 'unsupported' | 'unknown';
  evidence: string[];
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
  code_one_liner: z.string().max(100).optional().default(''),
  what_it_does: z.string(),
  
  // Core determination
  has_core: z.boolean(),
  core_value: z.string().nullable(),
  why_core: z.string().nullable(),
  
  // Evidence-anchored fields
  core_evidence: z.array(CoreEvidenceSchema).optional().default([]),
  readme_claims: z.array(ReadmeClaimSchema).optional().default([]),
  mismatch_evidence: z.array(MismatchEvidenceSchema).optional().default([]),
  
  // Keep/cut lists
  keep: z.array(z.string()),
  cut: z.array(z.string()),
  
  // Verdict
  verdict: z.enum(['ship', 'cut_to_core', 'no_core', 'dead']),
  verdict_reason: z.string(),
  
  // Demo/shareability
  demo_command: z.string().nullable().optional().default(null),
  demo_artifact: z.enum(['screenshot', 'gif', 'cli_output', 'metric', 'api_example']).nullable().optional().default(null),
  shareable_angle: z.string().nullable().optional().default(null),
  
  // Objective pride
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
  homepage: string | null;
}

// ============ FEED TYPES ============

export interface RepoPotential {
  potential: string;
  icp: string;
  promise: string;
  positioning_angle: string;
  confidence: 'high' | 'medium' | 'low';
  prompt_version: string;
}

export interface LastContext {
  last_context: string;
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
  homepage: string | null;
  potential: RepoPotential;
  last_context: LastContext;
  next_step: NextStep;
  priority_score: number;
  stage: ProjectStage;
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

  // Check evidence requirements
  if (analysis.has_core && analysis.core_evidence.length < 2) {
    errors.push(`Core claims require at least 2 evidence entries, got ${analysis.core_evidence.length}`);
  }

  // Check tweet length
  if (analysis.tweet_draft && analysis.tweet_draft.length > 280) {
    errors.push(`Tweet too long: ${analysis.tweet_draft.length} chars`);
  }

  return { valid: errors.length === 0, errors };
}

