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

  // ============ GENERIC KEY-VALUE (for locks, flags, etc.) ============

  async get(key: string): Promise<string | null> {
    return kv.get<string>(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await kv.set(key, value, { ex: ttlSeconds });
    } else {
      await kv.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await kv.del(key);
  }

  // ============ WATCHED REPOS (for push notifications) ============

  async getWatchedRepos(): Promise<string[]> {
    const watched = await kv.get<string[]>('watched_repos');
    return watched || [];
  }

  async addWatchedRepo(fullName: string): Promise<void> {
    const watched = await this.getWatchedRepos();
    if (!watched.includes(fullName)) {
      watched.push(fullName);
      await kv.set('watched_repos', watched);
    }
  }

  async removeWatchedRepo(fullName: string): Promise<void> {
    const watched = await this.getWatchedRepos();
    const filtered = watched.filter(r => r !== fullName);
    await kv.set('watched_repos', filtered);
    // Also clear mute
    await kv.del(`muted:${fullName}`);
  }

  async isRepoWatched(fullName: string): Promise<boolean> {
    const watched = await this.getWatchedRepos();
    return watched.includes(fullName);
  }

  async muteWatchedRepo(fullName: string, muteUntil: string): Promise<void> {
    await kv.set(`muted:${fullName}`, muteUntil);
  }

  async getRepoMuteUntil(fullName: string): Promise<string | null> {
    return kv.get<string>(`muted:${fullName}`);
  }

  async isRepoMuted(fullName: string): Promise<boolean> {
    const muteUntil = await this.getRepoMuteUntil(fullName);
    if (!muteUntil) return false;
    return new Date(muteUntil) > new Date();
  }

  // Helper to find tracked repo by name only
  async getTrackedRepoByName(name: string): Promise<TrackedRepo | null> {
    const all = await this.getAllTrackedRepos();
    return all.find(r => r.name.toLowerCase() === name.toLowerCase()) || null;
  }

  // ============ PUSH TRACKING (idempotency) ============

  async getLastProcessedSha(fullName: string): Promise<string | null> {
    return kv.get<string>(`last_sha:${fullName}`);
  }

  async setLastProcessedSha(fullName: string, sha: string): Promise<void> {
    await kv.set(`last_sha:${fullName}`, sha);
  }
}

export const stateManager = new StateManager();
