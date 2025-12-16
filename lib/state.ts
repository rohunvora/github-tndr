import { kv } from '@vercel/kv';
import { TrackedRepo, RepoState } from './core-types.js';

// Note: Feed memory functions (getFeedMemory, markCardShown, etc.) 
// are in lib/card-generator.ts to avoid circular dependencies

export class StateManager {
  // ============ TRACKED REPOS ============

  async getTrackedRepo(owner: string, name: string): Promise<TrackedRepo | null> {
    return kv.get<TrackedRepo>(`tracked:${owner}/${name}`);
  }

  async saveTrackedRepo(repo: TrackedRepo): Promise<void> {
    await kv.set(`tracked:${repo.owner}/${repo.name}`, repo);
  }

  async getAllTrackedRepos(): Promise<TrackedRepo[]> {
    const keys = await kv.keys('tracked:*');
    if (keys.length === 0) return [];
    const repos = await Promise.all(keys.map(key => kv.get<TrackedRepo>(key)));
    return repos.filter((r): r is TrackedRepo => r !== null);
  }

  async getTrackedReposByState(state: RepoState): Promise<TrackedRepo[]> {
    const all = await this.getAllTrackedRepos();
    return all.filter(r => r.state === state);
  }

  async updateRepoState(owner: string, name: string, state: RepoState): Promise<void> {
    const repo = await this.getTrackedRepo(owner, name);
    if (repo) {
      repo.state = state;
      if (state === 'dead') repo.killed_at = new Date().toISOString();
      else if (state === 'shipped') repo.shipped_at = new Date().toISOString();
      await this.saveTrackedRepo(repo);
    }
  }

  async setPendingAction(owner: string, name: string, action: 'cut_to_core' | 'ship' | null): Promise<void> {
    const repo = await this.getTrackedRepo(owner, name);
    if (repo) {
      repo.pending_action = action;
      repo.pending_since = action ? new Date().toISOString() : null;
      await this.saveTrackedRepo(repo);
    }
  }

  async getReposWithPendingActions(): Promise<TrackedRepo[]> {
    const all = await this.getAllTrackedRepos();
    return all.filter(r => r.pending_action !== null);
  }

  // ============ MESSAGE -> REPO MAPPING ============

  async setMessageRepo(messageId: number, owner: string, name: string): Promise<void> {
    await kv.set(`msg:${messageId}`, { owner, name }, { ex: 86400 * 7 });
  }

  async getMessageRepo(messageId: number): Promise<{ owner: string; name: string } | null> {
    return kv.get<{ owner: string; name: string }>(`msg:${messageId}`);
  }

  async updateRepoMessageId(owner: string, name: string, messageId: number): Promise<void> {
    const repo = await this.getTrackedRepo(owner, name);
    if (repo) {
      repo.last_message_id = messageId;
      await this.saveTrackedRepo(repo);
    }
  }

  // ============ SCAN STATE ============

  async saveScanResult(scanId: string, results: {
    total: number;
    analyzed: number;
    ready: number;
    cut_to_core: number;
    no_core: number;
    dead: number;
    shipped: number;
  }): Promise<void> {
    await kv.set(`scan:${scanId}`, results, { ex: 86400 });
  }

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

  async setActiveScan(scanId: string): Promise<void> {
    await kv.set('scan:active', scanId);
  }

  async getActiveScan(): Promise<string | null> {
    return kv.get<string>('scan:active');
  }

  async cancelActiveScan(): Promise<void> {
    await kv.del('scan:active');
  }

  // ============ COUNTS ============

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
