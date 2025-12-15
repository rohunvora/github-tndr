// ============ EVIDENCE REFS (Structured, Verifiable) ============

export type EvidenceRef =
  | { kind: 'vercel_log'; deploymentId: string; excerpt: string }
  | { kind: 'code'; path: string; lines: [number, number]; excerpt: string }
  | { kind: 'file_missing'; path: string; expected: string }
  | { kind: 'env_diff'; missing: string[]; configured: string[]; source: string }
  | { kind: 'screenshot'; url: string; capturedAt: string }
  | { kind: 'http_check'; url: string; status: number; error?: string }
  | { kind: 'diff'; sha: string; files: string[]; excerpt: string };

// ============ GTM STAGES ============

export type GTMStage =
  | 'building'         // Core functionality incomplete or deploy broken
  | 'packaging'        // Works but not launch-ready
  | 'ready_to_launch'  // LaunchKit complete, can post today
  | 'launching'        // Post is drafted/queued
  | 'post_launch';     // Collecting feedback

// ============ GTM READINESS CHECKS (Deterministic) ============

export interface GTMReadinessChecks {
  // Deploy health
  deployGreen: boolean;
  urlLoads: boolean;
  
  // For web apps
  hasClearCTA: boolean;           // Found button/link with action text
  mobileUsable: boolean;          // Mobile screenshot doesn't look broken
  hasLandingContent: boolean;     // Has headline + description
  
  // For all projects
  hasReadme: boolean;
  hasDescription: boolean;
  hasDemoAsset: boolean;          // Screenshot exists
  
  // Evidence for each check
  evidence: EvidenceRef[];
}

// ============ NOTIFICATION DEDUPE ============

export interface NotificationKey {
  deploymentId: string | null;
  latestCommitSha: string | null;
  deployStatus: string;
  missingEnvVars: string[];
  gtmStage: GTMStage;
}

export function computeNotificationKey(key: NotificationKey): string {
  return JSON.stringify({
    d: key.deploymentId,
    c: key.latestCommitSha,
    s: key.deployStatus,
    e: key.missingEnvVars.sort(),
    g: key.gtmStage,
  });
}

// ============ TODO SIGNALS ============

export interface TodoSignal {
  file: string;
  line: number;
  text: string;
  relevance: 'recent_change' | 'critical_path';
}

// ============ ACTION TYPES ============

export type ActionType = 'build' | 'gtm';

export interface NextAction {
  action: string;
  actionType: ActionType;
  rationale: string;
  effort: 'small' | 'medium' | 'large';
  artifact: 'cursor_prompt' | 'launch_post' | 'landing_copy' | 'env_checklist' | 'none';
  evidence: EvidenceRef[];
}

// ============ SHORTCOMING ============

export interface Shortcoming {
  issue: string;
  severity: 'critical' | 'major' | 'minor';
  evidence: EvidenceRef[];
  impact: string;
}

