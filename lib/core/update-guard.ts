/**
 * Update Guard - Idempotency and Locking for Telegram Webhooks
 * 
 * Prevents duplicate processing caused by:
 * - Telegram webhook retries (handler takes >30s, Telegram resends)
 * - User rapid-fire clicking the same button
 * - Network issues causing duplicate requests
 * 
 * ## TWO LAYERS OF PROTECTION
 * 
 * ### Layer 1: Update Deduplication
 * Telegram includes a unique `update_id` with each webhook. If a handler takes
 * too long (>30s), Telegram assumes it failed and retries with the SAME update_id.
 * By tracking processed update_ids, we can skip retries immediately.
 * 
 * ### Layer 2: Command Locking
 * For expensive operations (AI calls, image generation), we acquire a lock before
 * starting. If another request tries to run the same operation, it gets a friendly
 * "already processing" message instead of creating duplicate work.
 * 
 * ## USAGE
 * 
 * ### At webhook entry (api/telegram.ts):
 * ```typescript
 * import { isUpdateProcessed, markUpdateProcessed } from '../lib/core/update-guard.js';
 * 
 * const update = await req.json();
 * if (await isUpdateProcessed(update.update_id)) {
 *   return new Response(JSON.stringify({ ok: true }));  // Skip retry
 * }
 * await markUpdateProcessed(update.update_id);
 * ```
 * 
 * ### In command handlers:
 * ```typescript
 * import { acquireLock, releaseLock } from '../lib/core/update-guard.js';
 * 
 * async function handleExpensiveCommand(ctx, input) {
 *   const lockKey = `mycommand:${ctx.chat.id}:${input}`;
 *   if (!await acquireLock(lockKey, 120)) {
 *     await ctx.reply('⏳ Already processing...');
 *     return;
 *   }
 *   try {
 *     // ... expensive work
 *   } finally {
 *     await releaseLock(lockKey);
 *   }
 * }
 * ```
 * 
 * ### Or use the helper wrapper:
 * ```typescript
 * const result = await withLock(`preview:${chatId}:${repo}`, async () => {
 *   return await generatePreview(repo);
 * });
 * if (result === null) {
 *   await ctx.reply('⏳ Already generating...');
 * }
 * ```
 */

import { kv } from '@vercel/kv';
import { info } from './logger.js';

// ============ CONSTANTS ============

/** TTL for processed update IDs (5 minutes - plenty for Telegram's retry window) */
const UPDATE_TTL_SECONDS = 5 * 60;

/** Default TTL for command locks (2 minutes - enough for most operations) */
const DEFAULT_LOCK_TTL_SECONDS = 120;

// ============ UPDATE DEDUPLICATION (Layer 1) ============

/**
 * Check if a Telegram update has already been processed
 * 
 * Use this at the top of your webhook handler to skip Telegram retries.
 * Telegram retries webhooks after ~30s if it doesn't get a 200 response in time.
 * 
 * @param updateId - Telegram update_id from the webhook payload
 * @returns true if already processed (skip this update), false if new
 */
export async function isUpdateProcessed(updateId: number): Promise<boolean> {
  const key = `update:${updateId}`;
  const exists = await kv.exists(key);
  return exists === 1;
}

/**
 * Mark a Telegram update as processed
 * 
 * Call this immediately after isUpdateProcessed returns false.
 * The update_id is stored with a 5-minute TTL (Telegram stops retrying after ~2 min).
 * 
 * @param updateId - Telegram update_id from the webhook payload
 */
export async function markUpdateProcessed(updateId: number): Promise<void> {
  const key = `update:${updateId}`;
  await kv.set(key, Date.now(), { ex: UPDATE_TTL_SECONDS });
}

// ============ COMMAND LOCKING (Layer 2) ============

/**
 * Try to acquire a lock for an expensive operation
 * 
 * Use this to prevent concurrent runs of the same expensive operation.
 * Common lock key patterns:
 * - `preview:${chatId}:${repoName}` - Per-repo preview generation
 * - `scan:${chatId}` - One scan at a time per user
 * - `next:${chatId}` - One card generation at a time
 * 
 * @param key - Unique lock identifier (include chatId + operation context)
 * @param ttlSeconds - Lock TTL (default: 120s). Lock auto-expires if not released.
 * @returns true if lock acquired, false if already locked by another request
 * 
 * @example
 * ```typescript
 * if (!await acquireLock(`preview:${chatId}:${repo}`, 120)) {
 *   await ctx.reply('⏳ Already generating...');
 *   return;
 * }
 * try {
 *   // ... do expensive work
 * } finally {
 *   await releaseLock(`preview:${chatId}:${repo}`);
 * }
 * ```
 */
export async function acquireLock(
  key: string,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS
): Promise<boolean> {
  const lockKey = `lock:${key}`;
  
  // Use SET NX (set if not exists) for atomic lock acquisition
  // Returns 'OK' if set, null if key already exists
  const result = await kv.set(lockKey, Date.now(), { ex: ttlSeconds, nx: true });
  
  const acquired = result === 'OK';
  if (acquired) {
    info('guard', 'Lock acquired', { key, ttl: ttlSeconds });
  } else {
    info('guard', 'Lock denied (already held)', { key });
  }
  
  return acquired;
}

/**
 * Release a lock after operation completes
 * 
 * Always call this in a finally block to ensure locks are released even on error.
 * Safe to call even if lock doesn't exist or was already released.
 * 
 * @param key - Same key used in acquireLock
 */
export async function releaseLock(key: string): Promise<void> {
  const lockKey = `lock:${key}`;
  await kv.del(lockKey);
  info('guard', 'Lock released', { key });
}

/**
 * Check if a lock is currently held (without acquiring)
 * 
 * Useful for UI feedback ("already processing") without trying to acquire.
 * 
 * @param key - Lock key to check
 * @returns true if locked, false if available
 */
export async function isLocked(key: string): Promise<boolean> {
  const lockKey = `lock:${key}`;
  const exists = await kv.exists(lockKey);
  return exists === 1;
}

// ============ HELPER WRAPPER ============

/**
 * Execute a function with automatic lock management
 * 
 * Acquires lock before running, releases after (even on error).
 * Returns null if lock couldn't be acquired.
 * 
 * @param key - Lock key
 * @param fn - Async function to execute while holding the lock
 * @param ttlSeconds - Lock TTL (default: 120s)
 * @returns Function result, or null if lock was unavailable
 * 
 * @example
 * ```typescript
 * const result = await withLock(`preview:${chatId}:${repo}`, async () => {
 *   const image = await generateImage(repo);
 *   await sendImage(ctx, image);
 *   return image;
 * });
 * 
 * if (result === null) {
 *   await ctx.reply('⏳ Already generating preview for this repo...');
 * }
 * ```
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS
): Promise<T | null> {
  if (!await acquireLock(key, ttlSeconds)) {
    return null;
  }
  
  try {
    return await fn();
  } finally {
    await releaseLock(key);
  }
}

// ============ CONVENIENCE EXPORTS ============

/**
 * Combined guard for webhook handlers
 * 
 * Checks update deduplication and marks as processed in one call.
 * Returns true if this update should be processed, false if it's a duplicate.
 * 
 * @param updateId - Telegram update_id
 * @returns true if should process, false if duplicate
 * 
 * @example
 * ```typescript
 * if (!await shouldProcessUpdate(update.update_id)) {
 *   return new Response(JSON.stringify({ ok: true }));
 * }
 * // ... handle the update
 * ```
 */
export async function shouldProcessUpdate(updateId: number): Promise<boolean> {
  if (await isUpdateProcessed(updateId)) {
    info('guard', 'Skipping duplicate update', { updateId });
    return false;
  }
  await markUpdateProcessed(updateId);
  return true;
}

