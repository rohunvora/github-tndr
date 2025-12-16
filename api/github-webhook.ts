export const config = {
  runtime: 'edge',
};

import { stateManager } from '../lib/state.js';
import { getFeedMemory, clearIntention } from '../lib/card-generator.js';
import { generateWhatChanged } from '../lib/ai/index.js';
import { formatCompletion } from '../lib/bot/format.js';
import { completionKeyboard } from '../lib/bot/keyboards.js';
import Anthropic from '@anthropic-ai/sdk';

// Telegram bot API for sending completion messages
async function sendTelegramMessage(
  chatId: string, 
  text: string, 
  keyboard?: object
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };
  
  if (keyboard) {
    body.reply_markup = keyboard;
  }
  
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// GitHub webhooks - update last_push_at and detect completions
export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.text();
    const event = JSON.parse(payload);
    const eventType = req.headers.get('x-github-event');

    if (eventType === 'push') {
      const fullName = event.repository?.full_name;
      
      if (fullName) {
        const [owner, name] = fullName.split('/');
        
        // Check if we're tracking this repo
        const tracked = await stateManager.getTrackedRepo(owner, name);
        
        if (tracked) {
          // Update last push time
          tracked.last_push_at = event.head_commit?.timestamp || new Date().toISOString();
          await stateManager.saveTrackedRepo(tracked);
          
          // Check if this was the active card - if so, send completion message
          const feedMemory = await getFeedMemory();
          const isActiveCard = feedMemory.active_card === fullName;
          const hasIntention = feedMemory.intentions[fullName] !== undefined;
          
          if (isActiveCard || hasIntention) {
            // This push is related to active work - send completion notification
            const chatId = process.env.USER_TELEGRAM_CHAT_ID?.trim();
            
            if (chatId) {
              try {
                // Generate "what changed" summary
                const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
                
                const commitMessage = event.head_commit?.message || '';
                const filesChanged = (event.commits || [])
                  .flatMap((c: { added?: string[]; modified?: string[]; removed?: string[] }) => [
                    ...(c.added || []),
                    ...(c.modified || []),
                    ...(c.removed || []),
                  ])
                  .filter((f: string, i: number, arr: string[]) => arr.indexOf(f) === i)
                  .slice(0, 20);
                
                const previousStep = feedMemory.intentions[fullName]?.action;
                
                const whatChanged = await generateWhatChanged(anthropic, {
                  commit_sha: event.head_commit?.id || '',
                  commit_message: commitMessage,
                  files_changed: filesChanged,
                  previous_next_step: previousStep,
                });
                
                // Determine deploy URL (assumed pattern)
                const deployUrl = `https://${name}.vercel.app`;
                
                // Send completion message
                const message = formatCompletion(name, whatChanged.what_changed, deployUrl);
                await sendTelegramMessage(
                  chatId,
                  message,
                  { inline_keyboard: completionKeyboard(fullName).inline_keyboard }
                );
                
                // Clear the intention if work matched expected
                if (whatChanged.matches_expected === 'yes' && hasIntention) {
                  await clearIntention(fullName);
                }
                
                return new Response(JSON.stringify({ 
                  success: true, 
                  repo: fullName,
                  action: 'completion_sent',
                  what_changed: whatChanged.what_changed,
                }), {
                  headers: { 'Content-Type': 'application/json' },
                });
              } catch (error) {
                console.error('Failed to send completion message:', error);
                // Continue without sending message
              }
            }
          }
          
          return new Response(JSON.stringify({ 
            success: true, 
            repo: fullName,
            action: 'updated_push_time',
            pending_action: tracked.pending_action,
          }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, action: 'ignored' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('GitHub webhook error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
