import { kv } from '@vercel/kv';
import { RepoCard } from './core-types.js';

export interface CardSession {
  id: string;                                    // Short ID: "c_9f3a2b"
  card: RepoCard;                                // Full card payload
  version: number;                               // Increments on each state change
  view: 'card' | 'deep' | 'confirm_ship';
  created_at: string;
}

/**
 * Generate a short random ID (6 chars = 2B+ combinations)
 * Format: c_XXXXXX where X is alphanumeric
 */
function generateShortId(): string {
  return 'c_' + Math.random().toString(36).substring(2, 8);
}

/**
 * Create a new card session and store in KV
 * TTL: 24 hours
 */
export async function createCardSession(card: RepoCard): Promise<CardSession> {
  const session: CardSession = {
    id: generateShortId(),
    card,
    version: 1,
    view: 'card',
    created_at: new Date().toISOString(),
  };
  
  await kv.set(`cs:${session.id}`, session, { ex: 86400 }); // 24h TTL
  
  return session;
}

/**
 * Get a card session by ID
 */
export async function getCardSession(id: string): Promise<CardSession | null> {
  return kv.get<CardSession>(`cs:${id}`);
}

/**
 * Update a card session's view state
 * Increments version automatically
 */
export async function updateCardSession(
  id: string,
  updates: Partial<Pick<CardSession, 'view' | 'card'>>
): Promise<CardSession | null> {
  const session = await getCardSession(id);
  if (!session) return null;
  
  const updated: CardSession = {
    ...session,
    ...updates,
    version: session.version + 1,
  };
  
  await kv.set(`cs:${id}`, updated, { ex: 86400 }); // Refresh TTL
  
  return updated;
}

/**
 * Replace a session's card (for skip -> next card flow)
 * Creates a NEW session ID so old buttons become stale
 */
export async function replaceCardSession(
  oldId: string,
  newCard: RepoCard
): Promise<CardSession> {
  // Delete old session
  await kv.del(`cs:${oldId}`);
  
  // Create new session with fresh ID
  return createCardSession(newCard);
}
