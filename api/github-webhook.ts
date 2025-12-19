export const config = { runtime: 'edge', maxDuration: 30 };

import { info, error as logErr } from '../lib/logger.js';
import { stateManager } from '../lib/state.js';

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
    name: string;
  };
  sender: {
    login: string;
  };
}

/**
 * Verify GitHub webhook signature using Web Crypto API (Edge-compatible)
 */
async function verifySignature(payload: string, signature: string | null): Promise<boolean> {
  if (!GITHUB_WEBHOOK_SECRET) {
    info('webhook', 'No secret configured, skipping verification');
    return true;
  }
  
  if (!signature) return false;
  
  const sig = signature.replace('sha256=', '');
  
  // Import the secret key for HMAC
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(GITHUB_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // Sign the payload
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  
  // Convert to hex string
  const digest = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Timing-safe comparison
  if (sig.length !== digest.length) return false;
  let result = 0;
  for (let i = 0; i < sig.length; i++) {
    result |= sig.charCodeAt(i) ^ digest.charCodeAt(i);
  }
  return result === 0;
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
  
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram error: ${err}`);
  }
}

/**
 * Create keyboard for push notification
 */
function pushKeyboard(fullName: string) {
  const [owner, name] = fullName.split('/');
  return {
    inline_keyboard: [
      [
        { text: '🔇 Mute 1d', callback_data: `mute:${owner}:${name}:1d` },
        { text: '🔇 Mute 1w', callback_data: `mute:${owner}:${name}:1w` },
      ],
      [
        { text: '📋 Analyze', callback_data: `reanalyze:${owner}:${name}` },
      ],
    ],
  };
}

/**
 * Format a simple push notification (no AI, just commit summary)
 * Saves AI costs - use "Analyze" button for AI insight
 */
function formatSimplePush(
  repoName: string,
  fullName: string,
  commits: Array<{
    id: string;
    message: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>
): string {
  const lines: string[] = [];
  
  // Link to commit (single) or compare view (multiple)
  const headSha = commits[0]?.id;
  const tailSha = commits[commits.length - 1]?.id;
  let link: string;
  if (commits.length === 1 && headSha) {
    link = `https://github.com/${fullName}/commit/${headSha}`;
  } else if (headSha && tailSha) {
    // Compare from oldest to newest (tail...head)
    link = `https://github.com/${fullName}/compare/${tailSha.slice(0, 7)}^...${headSha.slice(0, 7)}`;
  } else {
    link = `https://github.com/${fullName}`;
  }
  
  lines.push(`⚡ [**${repoName}**](${link}) pushed`);
  lines.push('');
  
  // Show up to 5 commits
  const displayCommits = commits.slice(0, 5);
  let totalFiles = 0;
  
  for (const commit of displayCommits) {
    // Truncate message at 50 chars, take first line only
    const firstLine = commit.message.split('\n')[0];
    const truncated = firstLine.length > 50 ? firstLine.slice(0, 47) + '...' : firstLine;
    
    // Build file count string
    const counts: string[] = [];
    if (commit.added.length > 0) counts.push(`+${commit.added.length}`);
    if (commit.removed.length > 0) counts.push(`-${commit.removed.length}`);
    if (commit.modified.length > 0) counts.push(`~${commit.modified.length}`);
    
    const countStr = counts.length > 0 ? ` (${counts.join(', ')})` : '';
    lines.push(`• "${truncated}"${countStr}`);
    
    totalFiles += commit.added.length + commit.removed.length + commit.modified.length;
  }
  
  // Show if more commits were truncated
  if (commits.length > 5) {
    lines.push(`_... +${commits.length - 5} more commits_`);
    // Count files from remaining commits
    for (let i = 5; i < commits.length; i++) {
      const c = commits[i];
      totalFiles += c.added.length + c.removed.length + c.modified.length;
    }
  }
  
  lines.push('');
  lines.push(`📁 ${totalFiles} file${totalFiles !== 1 ? 's' : ''} changed`);
  
  return lines.join('\n');
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const event = req.headers.get('X-GitHub-Event');
  const signature = req.headers.get('X-Hub-Signature-256');
  
  // Only handle push events
  if (event !== 'push') {
    return new Response(JSON.stringify({ ok: true, skipped: 'not push event' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  const payload = await req.text();
          
  // Verify signature
  if (!await verifySignature(payload, signature)) {
    info('webhook', 'Invalid signature');
    return new Response('Invalid signature', { status: 401 });
  }
  
  try {
    const push: PushEvent = JSON.parse(payload);
    const fullName = push.repository.full_name;
    const repoName = push.repository.name;
    const headSha = push.head_commit?.id || push.commits[0]?.id;
    
    info('webhook.push', 'Received', { 
      fullName, 
      ref: push.ref, 
      sha: headSha?.slice(0, 7),
      commits: push.commits.length,
    });
    
    // Only process default branch pushes
    const defaultBranch = `refs/heads/${push.repository.default_branch}`;
    if (push.ref !== defaultBranch) {
      info('webhook.push', 'Skipping non-default branch', { ref: push.ref });
      return new Response(JSON.stringify({ ok: true, skipped: 'not default branch' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Skip empty pushes (e.g., branch creation with no commits)
    if (push.commits.length === 0) {
      info('webhook.push', 'No commits', { fullName });
      return new Response(JSON.stringify({ ok: true, skipped: 'no commits' }), {
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
        info('webhook.push', 'Duplicate', { fullName, sha: headSha.slice(0, 7) });
        return new Response(JSON.stringify({ ok: true, skipped: 'duplicate' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      await stateManager.setLastProcessedSha(fullName, headSha);
    }
    
    // Format simple push notification (no AI - saves costs)
    // Use "Analyze" button for AI insight when needed
    const message = formatSimplePush(repoName, fullName, push.commits);
    
    // Send notification
    info('webhook.push', 'Sending simple notification', { fullName, commits: push.commits.length });
    await sendTelegram(message, pushKeyboard(fullName));
    
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
