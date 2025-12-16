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

// ============ CORE ANALYSIS (LLM Output) ============

export const CoreAnalysisSchema = z.object({
  one_liner: z.string().max(140),
  what_it_does: z.string(),
  has_core: z.boolean(),
  core_value: z.string().nullable(),
  why_core: z.string().nullable(),
  keep: z.array(z.string()),
  cut: z.array(z.string()),
  verdict: z.enum(['ship', 'cut_to_core', 'no_core', 'dead']),
  verdict_reason: z.string(),
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

  // Check tweet length
  if (analysis.tweet_draft && analysis.tweet_draft.length > 280) {
    errors.push(`Tweet too long: ${analysis.tweet_draft.length} chars`);
  }

  return { valid: errors.length === 0, errors };
}
