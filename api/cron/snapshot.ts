export const config = {
  runtime: 'edge',
};

import { Bot, InputFile } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { Collector, ProjectSnapshot } from '../../lib/collector.js';
import { Reasoner, ProjectAssessment } from '../../lib/reasoner.js';
import { profileManager } from '../../lib/profile.js';
import { stateManager } from '../../lib/state.js';

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

// ============ MESSAGE FORMATTING ============

function formatGTMStage(stage: string): string {
  switch (stage) {
    case 'building': return '🔨 Building';
    case 'packaging': return '📦 Packaging';
    case 'ready_to_launch': return '🚀 Ready to Launch';
    case 'launching': return '📣 Launching';
    case 'post_launch': return '📊 Post-Launch';
    default: return '';
  }
}

function formatMainMessage(snapshot: ProjectSnapshot, assessment: ProjectAssessment): string {
  const stage = formatGTMStage(snapshot.gtmStage);
  
  let msg = `**${snapshot.name}** ${stage}\n\n`;
  
  if (assessment.primaryShortcoming) {
    msg += `${assessment.primaryShortcoming.issue}\n`;
    const evidence = assessment.primaryShortcoming.evidence[0];
    if (evidence) {
      if (evidence.kind === 'vercel_log') {
        msg += `\`${evidence.excerpt.substring(0, 100)}\`\n`;
      } else if (evidence.kind === 'env_diff') {
        msg += `Missing: \`${evidence.missing.slice(0, 3).join('`, `')}\`\n`;
      }
    }
    msg += '\n';
  }
  
  if (snapshot.deployment.url) {
    msg += `🔗 ${snapshot.deployment.url}\n\n`;
  }
  
  // Add question based on artifact type
  switch (assessment.nextAction.artifact) {
    case 'cursor_prompt':
      msg += `Want a Cursor prompt to fix this?`;
      break;
    case 'launch_post':
      msg += `Ready to post? I can draft the announcement.`;
      break;
    case 'env_checklist':
      msg += `Need the env var checklist?`;
      break;
    default:
      msg += `What's next?`;
  }
  
  return msg;
}

// ============ HANDLER ============

export default async function handler() {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!, { 
    botInfo: getBotInfo(process.env.TELEGRAM_BOT_TOKEN!) 
  });
  const chatId = process.env.USER_TELEGRAM_CHAT_ID!.trim();

  const collector = new Collector(
    process.env.GITHUB_TOKEN!,
    process.env.VERCEL_TOKEN!,
    process.env.VERCEL_TEAM_ID
  );

  const reasoner = new Reasoner(
    process.env.ANTHROPIC_API_KEY!,
    process.env.VERCEL_TEAM_ID
  );

  try {
    // Check if globally snoozed
    const prefs = await stateManager.getUserPreferences();
    if (prefs.lastCheckIn && new Date(prefs.lastCheckIn) > new Date()) {
      return new Response(JSON.stringify({ skipped: 'global-snooze' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Collect all active projects
    const snapshots = await collector.collectTopProjects(10);
    
    if (snapshots.length === 0) {
      return new Response(JSON.stringify({ skipped: 'no-projects' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Find the ONE project to message about (prioritize operational issues)
    let targetSnapshot: ProjectSnapshot | null = null;
    let targetAssessment: ProjectAssessment | null = null;

    for (const snapshot of snapshots) {
      // Skip snoozed/done
      const isSnoozed = await stateManager.isProjectSnoozed(snapshot.name);
      const isDone = await stateManager.isProjectDone(snapshot.name);
      if (isSnoozed || isDone) continue;

      // Check dedupe - no change = no message
      const shouldNotify = await profileManager.shouldNotify(snapshot.name, snapshot.notificationKey);
      if (!shouldNotify) continue;

      // Analyze
      const userProfile = await profileManager.getUserProfile();
      const assessment = await reasoner.analyze(snapshot, userProfile);

      // Only message if shouldAutoMessage is true
      if (assessment.shouldAutoMessage) {
        targetSnapshot = snapshot;
        targetAssessment = assessment;
        break; // Take the first one with auto-message
      }
    }

    if (!targetSnapshot || !targetAssessment) {
      return new Response(JSON.stringify({ skipped: 'no-actionable-change' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check verification loop - did a previous recommendation get resolved?
    const pending = await profileManager.getPendingVerification(targetSnapshot.name);
    if (pending && pending.previousNotificationKey !== targetSnapshot.notificationKey) {
      // State changed since recommendation - check if resolved
      if (targetSnapshot.deployment.status === 'ready' && pending.expectedOutcome === 'error_fixed') {
        // Success! Send verification message
        const verificationMsg = `✅ **${targetSnapshot.name}** deploy is green now!\n\n`;
        const followUp = targetSnapshot.gtmStage === 'ready_to_launch' 
          ? `Ready to share it?`
          : `What's next?`;
        
        await bot.api.sendMessage(chatId, verificationMsg + followUp, { parse_mode: 'Markdown' });
        await profileManager.clearPendingVerification(targetSnapshot.name);
        await profileManager.setLastNotificationKey(targetSnapshot.name, targetSnapshot.notificationKey);
        
        return new Response(JSON.stringify({ 
          success: true, 
          type: 'verification',
          project: targetSnapshot.name,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Send main message
    const message = formatMainMessage(targetSnapshot, targetAssessment);
    
    // Try with screenshot
    if (targetSnapshot.screenshot.url) {
      try {
        const imageResponse = await fetch(targetSnapshot.screenshot.url);
        if (imageResponse.ok) {
          const imageBuffer = await imageResponse.arrayBuffer();
          await bot.api.sendPhoto(chatId, new InputFile(new Uint8Array(imageBuffer)), {
            caption: message,
            parse_mode: 'Markdown',
          });
        } else {
          await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
      } catch {
        await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } else {
      await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    // Update state
    await stateManager.setActiveProject(targetSnapshot.name);
    await stateManager.saveSnapshot(targetSnapshot.name, targetSnapshot);
    await profileManager.setLastNotificationKey(targetSnapshot.name, targetSnapshot.notificationKey);
    
    // Set pending verification
    if (targetAssessment.nextAction.artifact !== 'none') {
      await profileManager.setPendingVerification({
        projectName: targetSnapshot.name,
        recommendedAction: targetAssessment.nextAction.action,
        recommendedAt: new Date().toISOString(),
        expectedOutcome: targetSnapshot.operationalBlocker ? 'error_fixed' : 'gtm_ready',
        previousNotificationKey: targetSnapshot.notificationKey,
      });
    }

    // Record conversation
    await stateManager.addConversationMessage({
      role: 'assistant',
      content: message,
      timestamp: new Date().toISOString(),
      metadata: {
        projectName: targetSnapshot.name,
        askedAbout: targetAssessment.nextAction.artifact,
      },
    });

    return new Response(JSON.stringify({ 
      success: true,
      project: targetSnapshot.name,
      blocker: targetAssessment.primaryShortcoming?.issue || 'none',
      gtmStage: targetSnapshot.gtmStage,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Snapshot cron error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
