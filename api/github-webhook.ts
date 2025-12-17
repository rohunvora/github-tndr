export const config = { runtime: 'edge', maxDuration: 30 };

import crypto from 'crypto';
import { info, error as logErr } from '../lib/logger.js';
import { stateManager } from '../lib/state.js';
import { analyzePush, PushAnalysisResult } from '../lib/push-analyzer.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.USER_TELEGRAM_CHAT_ID!;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

interface PushEvent {
  ref: string;
  head_commit: {
    id: string;
    message: string;
  } | null;
  commits: Array<{
    id: string;
    message: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  repository: {
    full_name: string;
    default_branch: string;
  };
  sender: {
    login: string;
  };
}

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload: string, signature: string | null): boolean {
  if (!GITHUB_WEBHOOK_SECRET) {
    info('webhook', 'No secret configured, skipping verification');
    return true;
  }
  
  if (!signature) return false;
  
  const sig = signature.replace('sha256=', '');
  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  const digest = hmac.update(payload).digest('hex');
  
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
}

/**
 * Send message to Telegram
 */
async function sendTelegram(text: string, replyMarkup?: object): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'Markdown',
  };
  
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Format push notification message
 */
function formatPushMessage(fullName: string, result: PushAnalysisResult): string {
  const name = fullName.split('/')[1];
  const lines: string[] = [`⚡ **${name}** pushed\n`];
  
  if (result.cutFilesDeleted.length > 0) {
    const count = result.cutFilesDeleted.length;
    lines.push(`🗑️ Deleted ${count} file${count > 1 ? 's' : ''} from cut list`);
    if (result.cutRemaining !== null) {
      lines.push(`   (${result.cutRemaining} remaining)`);
    }
  }
  
  if (result.readmeChanged) {
    lines.push(`📝 README updated`);
  }
  
  if (result.blockersResolved.length > 0) {
    lines.push(`✓ Blocker resolved: ${result.blockersResolved[0]}`);
  }
  
  if (result.blockerCountChange) {
    const { before, after } = result.blockerCountChange;
    lines.push(`\nBlockers: ${before}→${after}`);
  }
  
  return lines.join('\n');
}

/**
 * Create mute keyboard for push notification
 */
function muteKeyboard(fullName: string) {
  const [owner, name] = fullName.split('/');
  return {
    inline_keyboard: [
      [
        { text: '🔇 1d', callback_data: `mute:${owner}:${name}:1d` },
        { text: '🔇 1w', callback_data: `mute:${owner}:${name}:1w` },
        { text: '🔇 stop', callback_data: `mute:${owner}:${name}:forever` },
      ],
      [
        { text: '🔄 Re-analyze', callback_data: `reanalyze:${owner}:${name}` },
      ],
    ],
  };
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const event = req.headers.get('X-GitHub-Event');
  const deliveryId = req.headers.get('X-GitHub-Delivery');
  const signature = req.headers.get('X-Hub-Signature-256');
  
  // Only handle push events
  if (event !== 'push') {
    return new Response(JSON.stringify({ ok: true, skipped: 'not push event' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  const payload = await req.text();
  
  // Verify signature
  if (!verifySignature(payload, signature)) {
    info('webhook', 'Invalid signature');
    return new Response('Invalid signature', { status: 401 });
  }
  
  try {
    const push: PushEvent = JSON.parse(payload);
    const fullName = push.repository.full_name;
    const headSha = push.head_commit?.id || push.commits[0]?.id;
    
    info('webhook.push', 'Received', { fullName, ref: push.ref, sha: headSha?.slice(0, 7) });
    
    // Check if this is the default branch
    const defaultBranch = `refs/heads/${push.repository.default_branch}`;
    if (push.ref !== defaultBranch) {
      info('webhook.push', 'Skipping non-default branch', { ref: push.ref, default: defaultBranch });
      return new Response(JSON.stringify({ ok: true, skipped: 'not default branch' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Check if repo is watched
    const isWatched = await stateManager.isRepoWatched(fullName);
    if (!isWatched) {
      info('webhook.push', 'Repo not watched', { fullName });
      return new Response(JSON.stringify({ ok: true, skipped: 'not watched' }), {
                  headers: { 'Content-Type': 'application/json' },
                });
    }
    
    // Check if muted
    const isMuted = await stateManager.isRepoMuted(fullName);
    if (isMuted) {
      info('webhook.push', 'Repo muted', { fullName });
      return new Response(JSON.stringify({ ok: true, skipped: 'muted' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
    
    // Idempotency check
    if (headSha) {
      const lastSha = await stateManager.getLastProcessedSha(fullName);
      if (lastSha === headSha) {
        info('webhook.push', 'Duplicate delivery', { fullName, sha: headSha.slice(0, 7) });
        return new Response(JSON.stringify({ ok: true, skipped: 'duplicate' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      await stateManager.setLastProcessedSha(fullName, headSha);
    }
    
    // Get tracked repo for analysis context
    const [owner, name] = fullName.split('/');
    const tracked = await stateManager.getTrackedRepo(owner, name);
    if (!tracked?.analysis) {
      info('webhook.push', 'No analysis for repo', { fullName });
      return new Response(JSON.stringify({ ok: true, skipped: 'no analysis' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Analyze the push
    const result = analyzePush(push.commits, tracked.analysis);
    
    // Only notify if meaningful
    if (!result.meaningful) {
      info('webhook.push', 'Not meaningful', { fullName });
      return new Response(JSON.stringify({ ok: true, skipped: 'not meaningful' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Send notification
    info('webhook.push', 'Sending notification', { fullName, result });
    const message = formatPushMessage(fullName, result);
    await sendTelegram(message, muteKeyboard(fullName));
    
    return new Response(JSON.stringify({ ok: true, notified: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
    
  } catch (err) {
    logErr('webhook.push', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
