import { kv } from '@vercel/kv';
import { GTMStage, EvidenceRef } from './types.js';

// ============ PROJECT PROFILE ============

export interface ProjectProfile {
  name: string;
  
  // Versioning
  profileVersion: number;
  lastUpdatedBy: 'collector' | 'reasoner' | 'user';
  lastUpdatedAt: string;
  
  // Inferred (from code analysis)
  inferredGoal: string | null;
  inferredGoalEvidence: EvidenceRef[];
  
  // Learned (from conversations)
  confirmedGoal: string | null;
  knownConstraints: string[];
  
  // GTM tracking
  gtmStage: GTMStage;
  launchKitGenerated: boolean;
  
  // History
  previousDiscussions: Array<{
    date: string;
    topic: string;
    outcome: string;
  }>;
}

// ============ USER PROFILE ============

export interface UserProfile {
  // Channels
  primaryLaunchChannel: 'x' | 'newsletter' | 'discord' | 'linkedin' | 'other';
  secondaryChannels: string[];
  
  // Voice
  voiceSamples: string[];
  tonePreference: 'casual' | 'professional' | 'technical' | 'playful';
  
  // Defaults
  defaultCTA: 'waitlist' | 'direct_link' | 'dm' | 'custom';
  customCTAText: string | null;
  toleranceForScrappy: 'mvp' | 'polished';
  
  // Context
  audienceSize: string | null;
  audienceDescription: string | null;
  
  // Setup complete
  setupComplete: boolean;
}

// ============ PENDING VERIFICATION ============

export interface PendingVerification {
  projectName: string;
  recommendedAction: string;
  recommendedAt: string;
  expectedOutcome: 'deploy_green' | 'env_var_set' | 'error_fixed' | 'gtm_ready';
  previousNotificationKey: string;
}

// ============ PROFILE MANAGER ============

export class ProfileManager {
  // ============ PROJECT PROFILES ============

  async getProjectProfile(projectName: string): Promise<ProjectProfile | null> {
    return kv.get<ProjectProfile>(`profile:${projectName}`);
  }

  async setProjectProfile(projectName: string, profile: Partial<ProjectProfile>): Promise<void> {
    const existing = await this.getProjectProfile(projectName);
    const updated: ProjectProfile = {
      name: projectName,
      profileVersion: (existing?.profileVersion || 0) + 1,
      lastUpdatedBy: profile.lastUpdatedBy || 'collector',
      lastUpdatedAt: new Date().toISOString(),
      inferredGoal: profile.inferredGoal ?? existing?.inferredGoal ?? null,
      inferredGoalEvidence: profile.inferredGoalEvidence ?? existing?.inferredGoalEvidence ?? [],
      confirmedGoal: profile.confirmedGoal ?? existing?.confirmedGoal ?? null,
      knownConstraints: profile.knownConstraints ?? existing?.knownConstraints ?? [],
      gtmStage: profile.gtmStage ?? existing?.gtmStage ?? 'building',
      launchKitGenerated: profile.launchKitGenerated ?? existing?.launchKitGenerated ?? false,
      previousDiscussions: profile.previousDiscussions ?? existing?.previousDiscussions ?? [],
    };
    await kv.set(`profile:${projectName}`, updated);
  }

  async addDiscussion(projectName: string, topic: string, outcome: string): Promise<void> {
    const profile = await this.getProjectProfile(projectName);
    const discussions = profile?.previousDiscussions || [];
    discussions.push({
      date: new Date().toISOString(),
      topic,
      outcome,
    });
    // Keep last 20 discussions
    await this.setProjectProfile(projectName, {
      previousDiscussions: discussions.slice(-20),
      lastUpdatedBy: 'reasoner',
    });
  }

  // ============ USER PROFILE ============

  async getUserProfile(): Promise<UserProfile> {
    const profile = await kv.get<UserProfile>('user:profile');
    return profile || {
      primaryLaunchChannel: 'x',
      secondaryChannels: [],
      voiceSamples: [],
      tonePreference: 'casual',
      defaultCTA: 'direct_link',
      customCTAText: null,
      toleranceForScrappy: 'mvp',
      audienceSize: null,
      audienceDescription: null,
      setupComplete: false,
    };
  }

  async setUserProfile(profile: Partial<UserProfile>): Promise<void> {
    const existing = await this.getUserProfile();
    await kv.set('user:profile', { ...existing, ...profile });
  }

  async isSetupComplete(): Promise<boolean> {
    const profile = await this.getUserProfile();
    return profile.setupComplete;
  }

  // ============ PENDING VERIFICATION ============

  async setPendingVerification(verification: PendingVerification): Promise<void> {
    await kv.set(`verification:${verification.projectName}`, verification, { ex: 86400 }); // 24h TTL
  }

  async getPendingVerification(projectName: string): Promise<PendingVerification | null> {
    return kv.get<PendingVerification>(`verification:${projectName}`);
  }

  async clearPendingVerification(projectName: string): Promise<void> {
    await kv.del(`verification:${projectName}`);
  }

  // ============ NOTIFICATION DEDUPE ============

  async getLastNotificationKey(projectName: string): Promise<string | null> {
    return kv.get<string>(`notif:${projectName}`);
  }

  async setLastNotificationKey(projectName: string, key: string): Promise<void> {
    await kv.set(`notif:${projectName}`, key);
  }

  async shouldNotify(projectName: string, currentKey: string): Promise<boolean> {
    const lastKey = await this.getLastNotificationKey(projectName);
    return lastKey !== currentKey;
  }
}

export const profileManager = new ProfileManager();

