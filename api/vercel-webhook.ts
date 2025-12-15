export const config = {
  runtime: 'edge',
};

import { Bot, InputFile } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { Collector } from '../lib/collector.js';
import { Reasoner } from '../lib/reasoner.js';
import { profileManager } from '../lib/profile.js';
import { stateManager } from '../lib/state.js';

function getBotInfo(token: string): UserFromGetMe {
  const botId = parseInt(token.split(':')[0], 10);
  return {
    id: botId,
    is_bot: true,
    first_name: 'Pusher',
    username: 'pusher_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  };
}

interface VercelWebhookEvent {
  type: string;
  payload: {
    deployment?: {
      name?: string;
      url?: string;
      readyState?: string;
    };
    project?: {
      name?: string;
    };
  };
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const event = await req.json() as VercelWebhookEvent;
    const eventType = event.type;

    // Only handle ready and error states (skip building)
    if (eventType === 'deployment.ready' || eventType === 'deployment.error') {
      const projectName = event.payload.deployment?.name || event.payload.project?.name;
      
      if (!projectName) {
        return new Response(JSON.stringify({ skipped: 'no-project' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check if snoozed
      const isSnoozed = await stateManager.isProjectSnoozed(projectName);
      if (isSnoozed) {
        return new Response(JSON.stringify({ skipped: 'snoozed' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Collect fresh snapshot
      const collector = new Collector(
        process.env.GITHUB_TOKEN!,
        process.env.VERCEL_TOKEN!,
        process.env.VERCEL_TEAM_ID
      );

      const snapshots = await collector.collectTopProjects(10);
      const snapshot = snapshots.find(s => s.name === projectName);

      if (!snapshot) {
        return new Response(JSON.stringify({ skipped: 'project-not-found' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check dedupe
      const shouldNotify = await profileManager.shouldNotify(projectName, snapshot.notificationKey);
      if (!shouldNotify) {
        return new Response(JSON.stringify({ skipped: 'no-change' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check pending verification
      const pending = await profileManager.getPendingVerification(projectName);
      
      if (pending && snapshot.deployment.status === 'ready' && pending.expectedOutcome === 'error_fixed') {
        // Verification success!
        const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!, { 
          botInfo: getBotInfo(process.env.TELEGRAM_BOT_TOKEN!) 
        });
        const chatId = process.env.USER_TELEGRAM_CHAT_ID!.trim();

        let msg = `✅ **${projectName}** deploy is green now!`;
        
        if (snapshot.screenshot.url) {
          msg += `\n\n🔗 ${snapshot.deployment.url}`;
        }
        
        const followUp = snapshot.gtmStage === 'ready_to_launch' ? 'Ready to share it?' : "What's next?";
        msg += `\n\n${followUp}`;

        // Send with screenshot if available
        if (snapshot.screenshot.url) {
          try {
            const imageResponse = await fetch(snapshot.screenshot.url);
            if (imageResponse.ok) {
              const imageBuffer = await imageResponse.arrayBuffer();
              await bot.api.sendPhoto(chatId, new InputFile(new Uint8Array(imageBuffer)), {
                caption: msg,
                parse_mode: 'Markdown',
              });
            } else {
              await bot.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            }
          } catch {
            await bot.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
          }
        } else {
          await bot.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }

        await profileManager.clearPendingVerification(projectName);
        await profileManager.setLastNotificationKey(projectName, snapshot.notificationKey);
        
        return new Response(JSON.stringify({ 
          success: true, 
          type: 'verification',
          project: projectName,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // For deploy errors, message immediately
      if (eventType === 'deployment.error' && snapshot.operationalBlocker) {
        const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!, { 
          botInfo: getBotInfo(process.env.TELEGRAM_BOT_TOKEN!) 
        });
        const chatId = process.env.USER_TELEGRAM_CHAT_ID!.trim();

        const reasoner = new Reasoner(
          process.env.ANTHROPIC_API_KEY!,
          process.env.VERCEL_TEAM_ID
        );

        const userProfile = await profileManager.getUserProfile();
        const assessment = await reasoner.analyze(snapshot, userProfile);

        let msg = `🔴 **${projectName}** deploy failed\n\n`;
        msg += `${snapshot.operationalBlocker.issue}\n`;
        
        const evidence = snapshot.operationalBlocker.evidence[0];
        if (evidence && evidence.kind === 'vercel_log') {
          msg += `\`${evidence.excerpt.substring(0, 100)}\`\n`;
        }
        
        msg += `\nWant a Cursor prompt to fix this?`;

        await bot.api.sendMessage(chatId, msg, { parse_mode: 'Markdown' });

        await stateManager.setActiveProject(projectName);
        await stateManager.saveSnapshot(projectName, snapshot);
        await profileManager.setLastNotificationKey(projectName, snapshot.notificationKey);
        await profileManager.setPendingVerification({
          projectName,
          recommendedAction: assessment.nextAction.action,
          recommendedAt: new Date().toISOString(),
          expectedOutcome: 'error_fixed',
          previousNotificationKey: snapshot.notificationKey,
        });

        return new Response(JSON.stringify({ 
          success: true, 
          type: 'error',
          project: projectName,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // For ready state, just update state - cron handles GTM messaging
      await profileManager.setLastNotificationKey(projectName, snapshot.notificationKey);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Vercel webhook error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
