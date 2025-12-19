/**
 * Preview Sessions Module
 * 
 * Manages preview session state using Vercel KV for persistence across
 * serverless function invocations. Sessions track the approval flow state,
 * accumulated feedback, and generated images.
 * 
 * Key features:
 * - TTL-based expiration (10 minutes - enough to approve, not stale forever)
 * - Base64 image storage (KV can't store Buffer directly)
 * - Simple CRUD operations
 * 
 * @example
 * ```typescript
 * // Create a session after generating an image
 * const sessionId = await createSession({
 *   owner: 'satoshi',
 *   name: 'my-repo',
 *   imageBase64: buffer.toString('base64'),
 *   feedback: [],
 *   attempt: 1,
 * });
 * 
 * // Later, retrieve and update
 * const session = await getSession(sessionId);
 * await updateSession(sessionId, { feedback: [...session.feedback, 'make it darker'] });
 * ```
 */

import { kv } from '@vercel/kv';

/** Session TTL in seconds (10 minutes - enough time to review and approve) */
const SESSION_TTL = 10 * 60;

/**
 * Preview session state stored in Vercel KV
 */
export interface PreviewSession {
  /** Unique session identifier */
  id: string;
  /** Repository owner (GitHub username/org) */
  owner: string;
  /** Repository name */
  name: string;
  /** Generated image as base64 string (KV can't store Buffer) */
  imageBase64: string;
  /** Accumulated user feedback from reject cycles */
  feedback: string[];
  /** Current generation attempt number */
  attempt: number;
  /** ISO timestamp when session was created */
  createdAt: string;
}

/**
 * Creates a new preview session and stores it in KV
 * 
 * @param data - Session data (id and createdAt are auto-generated)
 * @returns The generated session ID
 */
export async function createSession(
  data: Omit<PreviewSession, 'id' | 'createdAt'>
): Promise<string> {
  const id = `preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session: PreviewSession = {
    ...data,
    id,
    createdAt: new Date().toISOString(),
  };
  await kv.set(`session:${id}`, session, { ex: SESSION_TTL });
  return id;
}

/**
 * Retrieves a session by ID
 * 
 * @param id - Session ID
 * @returns Session data or null if expired/not found
 */
export async function getSession(id: string): Promise<PreviewSession | null> {
  return kv.get<PreviewSession>(`session:${id}`);
}

/**
 * Updates an existing session with partial data
 * Refreshes the TTL on update
 * 
 * @param id - Session ID
 * @param updates - Partial session data to merge
 */
export async function updateSession(
  id: string,
  updates: Partial<PreviewSession>
): Promise<void> {
  const session = await getSession(id);
  if (session) {
    await kv.set(`session:${id}`, { ...session, ...updates }, { ex: SESSION_TTL });
  }
}

/**
 * Deletes a session (e.g., on cancel or completion)
 * 
 * @param id - Session ID
 */
export async function deleteSession(id: string): Promise<void> {
  await kv.del(`session:${id}`);
}
