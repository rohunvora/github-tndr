import { kv } from '@vercel/kv';
import { ProjectSnapshot } from './collector.js';
import { ProjectAssessment } from './reasoner.js';

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

  // ============ SNAPSHOTS ============

  async saveSnapshot(projectName: string, snapshot: ProjectSnapshot): Promise<void> {
    await kv.set(`snapshot:${projectName}`, snapshot, { ex: 3600 });
  }

  async getSnapshot(projectName: string): Promise<ProjectSnapshot | null> {
    return kv.get<ProjectSnapshot>(`snapshot:${projectName}`);
  }

  async saveAssessment(projectName: string, assessment: ProjectAssessment): Promise<void> {
    await kv.set(`assessment:${projectName}`, assessment, { ex: 3600 });
  }

  async getAssessment(projectName: string): Promise<ProjectAssessment | null> {
    return kv.get<ProjectAssessment>(`assessment:${projectName}`);
  }

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
}

export const stateManager = new StateManager();
