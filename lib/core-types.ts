/**
 * Core Types - Re-exports from core
 * @deprecated Use lib/core/types.js directly
 */

export {
  // Repo types
  type RepoState,
  type Verdict,
  type ProjectStage,
  type TrackedRepo,
  type CoreAnalysis,
  CoreAnalysisSchema,
  validateAnalysis,
  
  // Evidence types
  type CoreEvidence,
  type MismatchEvidence,
  type ReadmeClaim,
  type PrideLevel,
  type DemoArtifact,
  CoreEvidenceSchema,
  MismatchEvidenceSchema,
  ReadmeClaimSchema,
  
  // Feed types
  type RepoPotential,
  type LastContext,
  type NextStep,
  type NextStepSource,
  type ArtifactType,
  type RepoCard,
} from './core/types.js';

// Additional types that may be in the original
import { z } from 'zod';
import { RepoPotentialOutputSchema, NextStepOutputSchema } from './core/types.js';

// Re-export schemas needed by AI functions
export const RepoPotentialInputSchema = z.object({
  repo_name: z.string(),
  repo_description: z.string(),
  readme_excerpt: z.string(),
  tech_stack: z.array(z.string()),
  known_audience_context: z.string().optional(),
});

export { RepoPotentialOutputSchema };

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

export { NextStepOutputSchema };

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

// Additional interfaces
export interface FeedMemory {
  shown_today: string[];
  skipped_today: string[];
  active_card: string | null;
  last_reset: string;
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
