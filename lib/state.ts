import { kv } from '@vercel/kv';
import { TrackedRepo, CoreAnalysis, RepoState } from './core-types.js';

// Legacy imports - kept for backwards compatibility during migration
// import { ProjectSnapshot } from './collector.js';
// import { ProjectAssessment } from './reasoner.js';

export interface ProjectState {
  repo: string;
  description: string | null;
  lastCommit: string | null;
  lastCommitMessage: string | null;
  vercelProject: string | null;
  lastDeploy: string | null;
  deployStatus: 'ready' | 'building' | 'error' | null;
  previewUrl: string | null;
  launchedAt: string | null;
  launchUrl: string | null;
  userFeedback: string[];
  status: 'idea' | 'building' | 'deployed' | 'launched' | 'validated' | 'abandoned';
}

export interface FocusState {
  projectName: string;
  lastOutreach: {
    timestamp: string;
    message: string;
    askedAbout: string;
    question: string;
  } | null;
  lastUserResponse: {
    timestamp: string;
    message: string;
    inferredIntent: string;
  } | null;
  snoozedUntil: string | null;
  markedDone: boolean;
}

export interface ConversationMessage {
  role: 'assistant' | 'user';
  content: string;
  timestamp: string;
  metadata?: {
    projectName?: string;
    askedAbout?: string;
    hasCopyBlock?: boolean;
  };
}

export interface UserPreferences {
  snoozedProjects: Record<string, string>;
  focusProject: string | null;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  lastCheckIn: string | null;
}

export class StateManager {
  // ============ PROJECT STATE ============
  
  async getProjectState(projectName: string): Promise<ProjectState | null> {
    return kv.get<ProjectState>(`project:${projectName}`);
  }

  async setProjectState(projectName: string, state: Partial<ProjectState>): Promise<void> {
    const existing = await this.getProjectState(projectName);
    await kv.set(`project:${projectName}`, { ...existing, ...state } as ProjectState);
  }

  async getAllProjects(): Promise<Array<{ name: string; state: ProjectState }>> {
    const keys = await kv.keys('project:*');
    const projects = await Promise.all(
      keys.map(async (key) => {
        const name = key.replace('project:', '');
        const state = await this.getProjectState(name);
        return { name, state: state! };
      })
    );
    return projects.filter(p => p.state !== null) as Array<{ name: string; state: ProjectState }>;
  }

  // ============ FOCUS STATE ============

  async getFocusState(projectName: string): Promise<FocusState | null> {
    return kv.get<FocusState>(`focus:${projectName}`);
  }

  async setFocusState(projectName: string, state: Partial<FocusState>): Promise<void> {
    const existing = await this.getFocusState(projectName);
    await kv.set(`focus:${projectName}`, {
      projectName,
      lastOutreach: existing?.lastOutreach || null,
      lastUserResponse: existing?.lastUserResponse || null,
      snoozedUntil: existing?.snoozedUntil || null,
      markedDone: existing?.markedDone || false,
      ...state,
    } as FocusState);
  }

  async recordOutreach(projectName: string, message: string, askedAbout: string, question: string): Promise<void> {
    await this.setFocusState(projectName, {
      lastOutreach: { timestamp: new Date().toISOString(), message, askedAbout, question },
    });
  }

  async recordUserResponse(projectName: string, message: string, inferredIntent: string): Promise<void> {
    await this.setFocusState(projectName, {
      lastUserResponse: { timestamp: new Date().toISOString(), message, inferredIntent },
    });
  }

  async snoozeProject(projectName: string, hours: number = 24): Promise<void> {
    const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    await this.setFocusState(projectName, { snoozedUntil });
  }

  async markProjectDone(projectName: string): Promise<void> {
    await this.setFocusState(projectName, { markedDone: true, snoozedUntil: null });
  }

  async isProjectSnoozed(projectName: string): Promise<boolean> {
    const focus = await this.getFocusState(projectName);
    if (!focus?.snoozedUntil) return false;
    return new Date(focus.snoozedUntil) > new Date();
  }

  async isProjectDone(projectName: string): Promise<boolean> {
    const focus = await this.getFocusState(projectName);
    return focus?.markedDone || false;
  }

  async getLastAskedAbout(projectName: string): Promise<string | null> {
    const focus = await this.getFocusState(projectName);
    return focus?.lastOutreach?.askedAbout || null;
  }

  // ============ ACTIVE PROJECT ============

  async setActiveProject(projectName: string): Promise<void> {
    await kv.set('state:activeProject', projectName);
  }

  async getActiveProject(): Promise<string | null> {
    return kv.get<string>('state:activeProject');
  }

  // ============ SNAPSHOTS (DEPRECATED - use TrackedRepo instead) ============
  // These methods are kept for backwards compatibility but should not be used
  // in new code. Use the TrackedRepo methods below instead.

  // ============ CONVERSATION ============

  async addConversationMessage(message: ConversationMessage): Promise<void> {
    const messages = await this.getRecentConversation();
    messages.push(message);
    await kv.set('memory:recent', messages.slice(-50));
  }

  async getRecentConversation(limit: number = 10): Promise<ConversationMessage[]> {
    const messages = await kv.get<ConversationMessage[]>('memory:recent');
    return (messages || []).slice(-limit);
  }

  // ============ USER PREFERENCES ============

  async getUserPreferences(): Promise<UserPreferences> {
    const prefs = await kv.get<UserPreferences>('user:preferences');
    return prefs || {
      snoozedProjects: {},
      focusProject: null,
      quietHoursStart: null,
      quietHoursEnd: null,
      lastCheckIn: null,
    };
  }

  async updateUserPreferences(updates: Partial<UserPreferences>): Promise<void> {
    const existing = await this.getUserPreferences();
    await kv.set('user:preferences', { ...existing, ...updates });
  }

  async setFocusProjectOverride(projectName: string | null): Promise<void> {
    await this.updateUserPreferences({ focusProject: projectName });
  }

  async getFocusProjectOverride(): Promise<string | null> {
    const prefs = await this.getUserPreferences();
    return prefs.focusProject;
  }

  // ============ LEGACY ============

  async addCommitment(commitment: { date: string; text: string; project: string }): Promise<void> {
    const commitments = await this.getCommitments();
    commitments.push({ ...commitment, resolved: false });
    await kv.set('memory:commitments', commitments);
  }

  async getCommitments(): Promise<Array<{ date: string; text: string; project: string; resolved: boolean }>> {
    return (await kv.get<Array<{ date: string; text: string; project: string; resolved: boolean }>>('memory:commitments')) || [];
  }

  async resolveCommitment(index: number): Promise<void> {
    const commitments = await this.getCommitments();
    if (commitments[index]) {
      commitments[index].resolved = true;
      await kv.set('memory:commitments', commitments);
    }
  }

  // ============ TRACKED REPOS (NEW) ============

  /**
   * Get a tracked repo by owner/name
   */
  async getTrackedRepo(owner: string, name: string): Promise<TrackedRepo | null> {
    return kv.get<TrackedRepo>(`tracked:${owner}/${name}`);
  }

  /**
   * Save a tracked repo
   */
  async saveTrackedRepo(repo: TrackedRepo): Promise<void> {
    await kv.set(`tracked:${repo.owner}/${repo.name}`, repo);
  }

  /**
   * Get all tracked repos
   */
  async getAllTrackedRepos(): Promise<TrackedRepo[]> {
    const keys = await kv.keys('tracked:*');
    if (keys.length === 0) return [];

    const repos = await Promise.all(
      keys.map(async (key) => {
        const repo = await kv.get<TrackedRepo>(key);
        return repo;
      })
    );

    return repos.filter((r): r is TrackedRepo => r !== null);
  }

  /**
   * Get tracked repos by state
   */
  async getTrackedReposByState(state: RepoState): Promise<TrackedRepo[]> {
    const all = await this.getAllTrackedRepos();
    return all.filter(r => r.state === state);
  }

  /**
   * Update tracked repo state
   */
  async updateRepoState(owner: string, name: string, state: RepoState): Promise<void> {
    const repo = await this.getTrackedRepo(owner, name);
    if (repo) {
      repo.state = state;
      if (state === 'dead') {
        repo.killed_at = new Date().toISOString();
      } else if (state === 'shipped') {
        repo.shipped_at = new Date().toISOString();
      }
      await this.saveTrackedRepo(repo);
    }
  }

  /**
   * Set pending action on a repo
   */
  async setPendingAction(owner: string, name: string, action: 'cut_to_core' | 'ship' | null): Promise<void> {
    const repo = await this.getTrackedRepo(owner, name);
    if (repo) {
      repo.pending_action = action;
      repo.pending_since = action ? new Date().toISOString() : null;
      await this.saveTrackedRepo(repo);
    }
  }

  /**
   * Get repos with pending actions
   */
  async getReposWithPendingActions(): Promise<TrackedRepo[]> {
    const all = await this.getAllTrackedRepos();
    return all.filter(r => r.pending_action !== null);
  }

  // ============ MESSAGE -> REPO MAPPING (for reply-to threading) ============

  /**
   * Store which repo a Telegram message is about
   */
  async setMessageRepo(messageId: number, owner: string, name: string): Promise<void> {
    await kv.set(`msg:${messageId}`, { owner, name }, { ex: 86400 * 7 }); // 7 day expiry
  }

  /**
   * Get which repo a Telegram message was about
   */
  async getMessageRepo(messageId: number): Promise<{ owner: string; name: string } | null> {
    return kv.get<{ owner: string; name: string }>(`msg:${messageId}`);
  }

  /**
   * Update the last message ID for a repo (for reply-to tracking)
   */
  async updateRepoMessageId(owner: string, name: string, messageId: number): Promise<void> {
    const repo = await this.getTrackedRepo(owner, name);
    if (repo) {
      repo.last_message_id = messageId;
      await this.saveTrackedRepo(repo);
    }
  }

  // ============ SCAN STATE ============

  /**
   * Store scan progress/results
   */
  async saveScanResult(scanId: string, results: {
    total: number;
    analyzed: number;
    ready: number;
    cut_to_core: number;
    no_core: number;
    dead: number;
    shipped: number;
  }): Promise<void> {
    await kv.set(`scan:${scanId}`, results, { ex: 86400 }); // 24 hour expiry
  }

  /**
   * Get scan results
   */
  async getScanResult(scanId: string): Promise<{
    total: number;
    analyzed: number;
    ready: number;
    cut_to_core: number;
    no_core: number;
    dead: number;
    shipped: number;
  } | null> {
    return kv.get(`scan:${scanId}`);
  }

  // ============ COUNTS FOR STATUS ============

  /**
   * Get repo counts by state
   */
  async getRepoCounts(): Promise<{
    total: number;
    ready: number;
    has_core: number;
    no_core: number;
    dead: number;
    shipped: number;
    analyzing: number;
  }> {
    const all = await this.getAllTrackedRepos();
    
    return {
      total: all.length,
      ready: all.filter(r => r.state === 'ready').length,
      has_core: all.filter(r => r.state === 'has_core').length,
      no_core: all.filter(r => r.state === 'no_core').length,
      dead: all.filter(r => r.state === 'dead').length,
      shipped: all.filter(r => r.state === 'shipped').length,
      analyzing: all.filter(r => r.state === 'analyzing').length,
    };
  }
}

export const stateManager = new StateManager();
