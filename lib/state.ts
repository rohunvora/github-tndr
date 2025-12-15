import { kv } from '@vercel/kv';

export interface ProjectState {
  repo: string;
  description: string | null;
  lastCommit: string | null;
  lastCommitMessage: string | null;
  vercelProject: string | null;
  lastDeploy: string | null;
  deployStatus: 'ready' | 'building' | 'error' | null;
  previewUrl: string | null;
  // GTM tracking
  launchedAt: string | null;
  launchUrl: string | null;
  userFeedback: string[];
  status: 'idea' | 'building' | 'deployed' | 'launched' | 'validated' | 'abandoned';
}

export interface Commitment {
  date: string;
  text: string;
  project: string;
  resolved: boolean;
}

export interface ConversationMessage {
  role: 'assistant' | 'user';
  content: string;
  timestamp: string;
}

export class StateManager {
  async getProjectState(projectName: string): Promise<ProjectState | null> {
    const data = await kv.get<ProjectState>(`project:${projectName}`);
    return data;
  }

  async setProjectState(projectName: string, state: Partial<ProjectState>): Promise<void> {
    const existing = await this.getProjectState(projectName);
    await kv.set(`project:${projectName}`, {
      ...existing,
      ...state,
    } as ProjectState);
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

  async addCommitment(commitment: Omit<Commitment, 'resolved'>): Promise<void> {
    const commitments = await this.getCommitments();
    commitments.push({ ...commitment, resolved: false });
    await kv.set('memory:commitments', commitments);
  }

  async getCommitments(): Promise<Commitment[]> {
    const commitments = await kv.get<Commitment[]>('memory:commitments');
    return commitments || [];
  }

  async resolveCommitment(index: number): Promise<void> {
    const commitments = await this.getCommitments();
    if (commitments[index]) {
      commitments[index].resolved = true;
      await kv.set('memory:commitments', commitments);
    }
  }

  async addConversationMessage(message: ConversationMessage): Promise<void> {
    const messages = await this.getRecentConversation();
    messages.push(message);
    // Keep only last 50 messages
    const recent = messages.slice(-50);
    await kv.set('memory:recent', recent);
  }

  async getRecentConversation(limit: number = 10): Promise<ConversationMessage[]> {
    const messages = await kv.get<ConversationMessage[]>('memory:recent');
    return (messages || []).slice(-limit);
  }
}

export const stateManager = new StateManager();

