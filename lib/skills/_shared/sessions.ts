/**
 * Session Manager
 *
 * Unified session management for all skills.
 * Replaces: in-memory Maps, direct KV calls, inconsistent key formats.
 *
 * All sessions are stored in Vercel KV with consistent key patterns.
 */

import { kv } from '@vercel/kv';
import type { SessionManager, SessionType, StoredSession } from './types.js';

// ============ SESSION MANAGER IMPLEMENTATION ============

/**
 * KV-backed session manager
 * Provides typed CRUD operations with automatic versioning and TTL
 */
export class KVSessionManager implements SessionManager {
  private readonly keyPrefix = 'skill:session';

  constructor(private store: typeof kv = kv) {}

  /**
   * Create new session with TTL
   * @returns Session ID
   */
  async create<T>(type: SessionType, data: T, ttlSeconds: number): Promise<string> {
    const id = this.generateId(type);
    const session: StoredSession<T> = {
      id,
      type,
      data,
      version: 1,
      createdAt: new Date().toISOString(),
    };

    await this.store.set(this.key(id), session, { ex: ttlSeconds });
    return id;
  }

  /**
   * Get session by ID
   * @returns Session or null if not found/expired
   */
  async get<T>(id: string): Promise<StoredSession<T> | null> {
    return this.store.get<StoredSession<T>>(this.key(id));
  }

  /**
   * Update session data
   * Increments version and refreshes TTL (24h default)
   */
  async update<T>(id: string, updates: Partial<T>, ttlSeconds = 86400): Promise<StoredSession<T>> {
    const existing = await this.get<T>(id);
    if (!existing) {
      throw new SessionNotFoundError(id);
    }

    const updated: StoredSession<T> = {
      ...existing,
      data: { ...existing.data, ...updates } as T,
      version: existing.version + 1,
    };

    await this.store.set(this.key(id), updated, { ex: ttlSeconds });
    return updated;
  }

  /**
   * Delete session
   */
  async delete(id: string): Promise<void> {
    await this.store.del(this.key(id));
  }

  /**
   * Validate version matches expected
   * Used for callback deduplication
   */
  validateVersion(session: StoredSession<unknown>, expectedVersion: number): boolean {
    return session.version === expectedVersion;
  }

  // ============ HELPERS ============

  private key(id: string): string {
    return `${this.keyPrefix}:${id}`;
  }

  private generateId(type: SessionType): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${type}_${timestamp}_${random}`;
  }
}

// ============ MOCK SESSION MANAGER FOR TESTING ============

/**
 * In-memory session manager for testing
 */
export class MockSessionManager implements SessionManager {
  private sessions = new Map<string, StoredSession<unknown>>();
  private idCounter = 0;

  async create<T>(type: SessionType, data: T, _ttlSeconds: number): Promise<string> {
    const id = `${type}_mock_${++this.idCounter}`;
    const session: StoredSession<T> = {
      id,
      type,
      data,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    return id;
  }

  async get<T>(id: string): Promise<StoredSession<T> | null> {
    return (this.sessions.get(id) as StoredSession<T>) ?? null;
  }

  async update<T>(id: string, updates: Partial<T>): Promise<StoredSession<T>> {
    const existing = await this.get<T>(id);
    if (!existing) {
      throw new SessionNotFoundError(id);
    }

    const updated: StoredSession<T> = {
      ...existing,
      data: { ...existing.data, ...updates } as T,
      version: existing.version + 1,
    };
    this.sessions.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  validateVersion(session: StoredSession<unknown>, expectedVersion: number): boolean {
    return session.version === expectedVersion;
  }

  // Test helpers
  clear(): void {
    this.sessions.clear();
    this.idCounter = 0;
  }

  getAll(): Map<string, StoredSession<unknown>> {
    return new Map(this.sessions);
  }
}

// ============ ERRORS ============

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session not found: ${id}`);
    this.name = 'SessionNotFoundError';
  }
}

// ============ DEFAULT TTLS ============

export const SESSION_TTLS = {
  card: 86400,      // 24 hours
  preview: 600,     // 10 minutes
  readme: 600,      // 10 minutes
  scan: 3600,       // 1 hour
} as const;

// ============ DEDUPLICATION LOCK ============

/**
 * Acquire a lock for expensive operations
 * Returns true if lock acquired, false if already locked
 */
export async function acquireSkillLock(
  key: string,
  ttlSeconds = 60,
  store: typeof kv = kv
): Promise<boolean> {
  const lockKey = `skill:lock:${key}`;
  const existing = await store.get(lockKey);
  if (existing) {
    return false;
  }
  await store.set(lockKey, true, { ex: ttlSeconds });
  return true;
}

/**
 * Release a lock
 */
export async function releaseSkillLock(
  key: string,
  store: typeof kv = kv
): Promise<void> {
  const lockKey = `skill:lock:${key}`;
  await store.del(lockKey);
}
