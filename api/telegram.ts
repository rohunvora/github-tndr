export const config = {
  runtime: 'edge',
};

import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { Collector, ProjectSnapshot } from '../lib/collector.js';
import { Reasoner, ProjectAssessment, ConversationMessage } from '../lib/reasoner.js';
import { profileManager } from '../lib/profile.js';
import { stateManager } from '../lib/state.js';
import { EvidenceRef } from '../lib/types.js';

// ============ BOT SETUP ============

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

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!, { botInfo: getBotInfo(process.env.TELEGRAM_BOT_TOKEN!) });
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

// ============ MESSAGE FORMATTING ============

function formatMainMessage(snapshot: ProjectSnapshot, assessment: ProjectAssessment): string {
  const stage = formatGTMStage(snapshot.gtmStage);
  const action = assessment.nextAction;
  
  let msg = `**${snapshot.name}** ${stage}\n\n`;
  
  // Add evidence-backed issue
  if (assessment.primaryShortcoming) {
    msg += `${assessment.primaryShortcoming.issue}\n`;
    
    // Add evidence excerpt if available
    const evidence = assessment.primaryShortcoming.evidence[0];
    if (evidence) {
      if (evidence.kind === 'vercel_log') {
        msg += `\`\`\`\n${evidence.excerpt.substring(0, 200)}\n\`\`\`\n`;
      } else if (evidence.kind === 'env_diff') {
        msg += `Missing: \`${evidence.missing.slice(0, 3).join('`, `')}\`\n`;
      }
    }
    msg += '\n';
  }
  
  // Add deploy URL
  if (snapshot.deployment.url) {
    msg += `🔗 ${snapshot.deployment.url}\n\n`;
  }
  
  // Add the ONE question
  msg += formatQuestion(action);
  
  return msg;
}

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

function formatQuestion(action: { action: string; artifact: string }): string {
  switch (action.artifact) {
    case 'cursor_prompt':
      return `Want a Cursor prompt to fix this?`;
    case 'launch_post':
      return `Ready to post? I can draft the announcement.`;
    case 'landing_copy':
      return `Want me to draft the landing copy?`;
    case 'env_checklist':
      return `Need the env var checklist?`;
    default:
      return `What's next?`;
  }
}

function formatArtifactMessage(assessment: ProjectAssessment): string | null {
  const { artifacts } = assessment;
  
  if (artifacts.cursorPrompt) {
    return `**Cursor Prompt:**\n\n${artifacts.cursorPrompt}`;
  }
  if (artifacts.launchPost) {
    return `**Launch Post:**\n\n${artifacts.launchPost}`;
  }
  if (artifacts.landingCopy) {
    return `**Landing Copy:**\n\n${artifacts.landingCopy}`;
  }
  if (artifacts.envChecklist) {
    return artifacts.envChecklist;
  }
  
  return null;
}

function createKeyboard(snapshot: ProjectSnapshot, assessment: ProjectAssessment): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  
  // Primary action based on artifact type
  switch (assessment.nextAction.artifact) {
    case 'cursor_prompt':
      keyboard.text('📝 Get Cursor Prompt', `prompt:${snapshot.name}`);
      break;
    case 'launch_post':
      keyboard.text('📣 Draft Post', `post:${snapshot.name}`);
      break;
    case 'landing_copy':
      keyboard.text('📄 Draft Copy', `copy:${snapshot.name}`);
      break;
    case 'env_checklist':
      keyboard.text('📋 Show Checklist', `env:${snapshot.name}`);
      break;
  }
  
  keyboard.row();
  keyboard.text('😴 Snooze 24h', `snooze:${snapshot.name}`);
  keyboard.text('✅ Done', `done:${snapshot.name}`);
  
  return keyboard;
}

// ============ SEND HELPERS ============

async function sendSnapshot(
  chatIdToSend: string,
  snapshot: ProjectSnapshot,
  assessment: ProjectAssessment
): Promise<void> {
  const mainMessage = formatMainMessage(snapshot, assessment);
  const keyboard = createKeyboard(snapshot, assessment);
  
  // Try to send with screenshot
  if (snapshot.screenshot.url) {
    try {
      const imageResponse = await fetch(snapshot.screenshot.url);
      if (imageResponse.ok) {
        const imageBuffer = await imageResponse.arrayBuffer();
        await bot.api.sendPhoto(chatIdToSend, new InputFile(new Uint8Array(imageBuffer)), {
          caption: mainMessage,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      }
    } catch (error) {
      console.error('Failed to send screenshot:', error);
    }
  }
  
  // Fallback to text-only
  await bot.api.sendMessage(chatIdToSend, mainMessage, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

async function sendArtifact(chatIdToSend: string, assessment: ProjectAssessment): Promise<void> {
  const artifactMessage = formatArtifactMessage(assessment);
  if (artifactMessage) {
    await bot.api.sendMessage(chatIdToSend, artifactMessage, {
      parse_mode: 'Markdown',
    });
  }
}

// ============ COMMANDS ============

bot.command('start', async (ctx) => {
  await ctx.reply(`Hey. I'm your project operator.

I watch your GitHub repos + Vercel deploys and help you **package and ship** to your audience.

**Commands:**
/check - Analyze your most active project
/status - Quick overview of all active projects
/focus <project> - Lock in on one project
/snooze [hours] - Pause notifications
/done - Mark current project shipped

Just reply to any message and I'll generate what you need: Cursor prompts, launch posts, landing copy.`);
});

bot.command('check', async (ctx) => {
  try {
    await ctx.reply('Analyzing your projects...');
    
    // Check for manual focus first
    const focusProject = await profileManager.getUserProfile().then(p => null); // TODO: add focus to user profile
    const activeProject = await stateManager.getActiveProject();
    
    // Collect top projects
    const snapshots = await collector.collectTopProjects(5);
    
    if (snapshots.length === 0) {
      await ctx.reply('No active projects found in the last 7 days. Push some code first!');
      return;
    }
    
    // Find the best project to focus on (prioritize operational issues)
    let targetSnapshot = snapshots[0];
    
    // Prefer projects with operational blockers
    const withBlocker = snapshots.find(s => s.operationalBlocker?.severity === 'critical');
    if (withBlocker) {
      targetSnapshot = withBlocker;
    }
    
    // Or prefer focused/active project
    if (activeProject) {
      const focused = snapshots.find(s => s.name === activeProject);
      if (focused) targetSnapshot = focused;
    }
    
    // Check if snoozed
    const isSnoozed = await stateManager.isProjectSnoozed(targetSnapshot.name);
    if (isSnoozed) {
      const alternative = snapshots.find(s => s.name !== targetSnapshot.name);
      if (alternative) targetSnapshot = alternative;
    }
    
    // Analyze
    const userProfile = await profileManager.getUserProfile();
    const assessment = await reasoner.analyze(targetSnapshot, userProfile);
    
    // Save state
    await stateManager.setActiveProject(targetSnapshot.name);
    await stateManager.saveSnapshot(targetSnapshot.name, targetSnapshot);
    await profileManager.setProjectProfile(targetSnapshot.name, {
      gtmStage: targetSnapshot.gtmStage,
      lastUpdatedBy: 'collector',
    });
    
    // Set pending verification if there's an action
    if (assessment.nextAction.artifact !== 'none') {
      await profileManager.setPendingVerification({
        projectName: targetSnapshot.name,
        recommendedAction: assessment.nextAction.action,
        recommendedAt: new Date().toISOString(),
        expectedOutcome: targetSnapshot.operationalBlocker ? 'error_fixed' : 'gtm_ready',
        previousNotificationKey: targetSnapshot.notificationKey,
      });
    }
    
    // Send snapshot with screenshot
    await sendSnapshot(ctx.chat!.id.toString(), targetSnapshot, assessment);
    
    // Record conversation
    await stateManager.addConversationMessage({
      role: 'assistant',
      content: formatMainMessage(targetSnapshot, assessment),
      timestamp: new Date().toISOString(),
      metadata: {
        projectName: targetSnapshot.name,
        askedAbout: assessment.nextAction.artifact,
      },
    });
  } catch (error) {
    console.error('Check error:', error);
    await ctx.reply('Analysis failed. Try again in a moment.');
  }
});

bot.command('status', async (ctx) => {
  try {
    await ctx.reply('Checking all projects...');
    
    const snapshots = await collector.collectTopProjects(10);
    
    if (snapshots.length === 0) {
      await ctx.reply('No active projects found in the last 7 days.');
      return;
    }
    
    let status = '**Your active projects:**\n\n';
    
    for (const snapshot of snapshots.slice(0, 5)) {
      const stage = formatGTMStage(snapshot.gtmStage);
      const icon = snapshot.operationalBlocker?.severity === 'critical' ? '🔴' :
                   snapshot.gtmStage === 'ready_to_launch' ? '🟢' :
                   snapshot.gtmStage === 'packaging' ? '🟡' : '⚪';
      
      status += `${icon} **${snapshot.name}** ${stage}\n`;
      
      if (snapshot.operationalBlocker) {
        status += `   ${snapshot.operationalBlocker.issue}\n`;
      } else if (snapshot.gtmBlocker) {
        status += `   ${snapshot.gtmBlocker.issue}\n`;
      }
      
      if (snapshot.deployment.url) {
        status += `   🔗 ${snapshot.deployment.url}\n`;
      }
      status += '\n';
    }
    
    status += `\nUse /check to dive into the most urgent one.`;
    
    await ctx.reply(status, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Status error:', error);
    await ctx.reply('Failed to check status. Try again.');
  }
});

bot.command('focus', async (ctx) => {
  const text = ctx.message?.text || ctx.msg?.text || '';
  const projectName = text.split(' ').slice(1)[0];
  
  if (!projectName) {
    await ctx.reply('Usage: /focus <project-name>');
    return;
  }
  
  await stateManager.setActiveProject(projectName);
  
  // Clear any snooze
  const focus = await stateManager.getFocusState(projectName);
  if (focus?.snoozedUntil) {
    await stateManager.setFocusState(projectName, { snoozedUntil: null });
  }
  
  await ctx.reply(`🎯 Locked in on **${projectName}**. Running /check now...`, { parse_mode: 'Markdown' });
  
  // Trigger a check
  try {
    const snapshots = await collector.collectTopProjects(10);
    const snapshot = snapshots.find(s => s.name === projectName);
    
    if (snapshot) {
      const userProfile = await profileManager.getUserProfile();
      const assessment = await reasoner.analyze(snapshot, userProfile);
      await sendSnapshot(ctx.chat!.id.toString(), snapshot, assessment);
    } else {
      await ctx.reply(`Couldn't find ${projectName} in your recent repos.`);
    }
  } catch (error) {
    console.error('Focus check error:', error);
  }
});

bot.command('snooze', async (ctx) => {
  const text = ctx.message?.text || ctx.msg?.text || '';
  const hours = parseInt(text.split(' ').slice(1)[0]) || 24;
  
  const activeProject = await stateManager.getActiveProject();
  
  if (activeProject) {
    await stateManager.snoozeProject(activeProject, hours);
    await ctx.reply(`😴 Snoozing **${activeProject}** for ${hours}h. I'll check back then.`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(`No active project. Use /check first.`);
  }
});

bot.command('done', async (ctx) => {
  const activeProject = await stateManager.getActiveProject();
  
  if (activeProject) {
    await stateManager.markProjectDone(activeProject);
    await stateManager.setProjectState(activeProject, {
      status: 'launched',
      launchedAt: new Date().toISOString(),
    });
    await profileManager.clearPendingVerification(activeProject);
    await profileManager.setProjectProfile(activeProject, {
      gtmStage: 'post_launch',
      lastUpdatedBy: 'user',
    });
    
    await ctx.reply(`🚀 **${activeProject}** marked as shipped! Nice work.\n\nHow did it go? Any feedback or metrics to share?`, { parse_mode: 'Markdown' });
    await stateManager.setActiveProject('');
  } else {
    await ctx.reply('No active project. Use /check first.');
  }
});

// ============ CALLBACK QUERIES (Button handlers) ============

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, projectName] = data.split(':');
  
  await ctx.answerCallbackQuery();
  
  // Get cached snapshot
  const snapshot = await stateManager.getSnapshot(projectName);
  if (!snapshot) {
    await ctx.reply(`Project ${projectName} not found. Run /check first.`);
    return;
  }
  
  switch (action) {
    case 'prompt':
    case 'post':
    case 'copy':
    case 'env': {
      // Generate and send the artifact
      const userProfile = await profileManager.getUserProfile();
      const assessment = await reasoner.analyze(snapshot, userProfile);
      await sendArtifact(ctx.chat!.id.toString(), assessment);
      break;
    }
    
    case 'followup': {
      // Generate follow-up post for post-launch updates
      const userProfile = await profileManager.getUserProfile();
      const assessment = await reasoner.analyze(snapshot, userProfile);
      
      // Generate a follow-up post
      if (assessment.artifacts.launchPost) {
        await ctx.reply(`**Follow-up Post:**\n\n${assessment.artifacts.launchPost}`, { parse_mode: 'Markdown' });
      } else {
        // Fallback: generate generic follow-up
        const followUp = `Update on ${snapshot.name}:\n\nWe've been listening to your feedback and making improvements.\n\n${snapshot.deployment.url ? `Check it out: ${snapshot.deployment.url}` : ''}`;
        await ctx.reply(`**Follow-up Post:**\n\n${followUp}`, { parse_mode: 'Markdown' });
      }
      break;
    }
    
    case 'snooze': {
      await stateManager.snoozeProject(projectName, 24);
      await ctx.reply(`😴 Snoozing **${projectName}** for 24h.`, { parse_mode: 'Markdown' });
      break;
    }
    
    case 'done': {
      await stateManager.markProjectDone(projectName);
      await stateManager.setProjectState(projectName, {
        status: 'launched',
        launchedAt: new Date().toISOString(),
      });
      await profileManager.clearPendingVerification(projectName);
      await ctx.reply(`✅ **${projectName}** marked done!`, { parse_mode: 'Markdown' });
      break;
    }
  }
});

// ============ POST-LAUNCH FEEDBACK PARSING ============

interface PostLaunchFeedback {
  hasFeedback: boolean;
  tractionSignal: string | null;   // "50 likes"
  featureRequest: string | null;   // "dark mode"
  rawExcerpt: string;
}

function parsePostLaunchFeedback(message: string): PostLaunchFeedback {
  // Traction: "got X likes/stars/users"
  const tractionMatch = message.match(/(\d+)\s*(likes?|stars?|users?|signups?|downloads?|views?|replies?)/i);
  
  // Feature requests: "asking for X", "want X", "need X", "requesting X"
  const requestPatterns = [
    /(?:people\s+(?:are\s+)?)?asking\s+(?:for\s+)?["']?([^"'.]+)["']?/i,
    /(?:they\s+)?(?:want|need|requesting)\s+["']?([^"'.]+)["']?/i,
  ];
  
  let featureRequest: string | null = null;
  for (const pattern of requestPatterns) {
    const match = message.match(pattern);
    if (match) {
      featureRequest = match[1].trim();
      break;
    }
  }
  
  return {
    hasFeedback: !!(tractionMatch || featureRequest),
    tractionSignal: tractionMatch ? `${tractionMatch[1]} ${tractionMatch[2]}` : null,
    featureRequest,
    rawExcerpt: message.substring(0, 200),
  };
}

async function sendPostLaunchResponse(
  chatIdToSend: string,
  snapshot: ProjectSnapshot,
  assessment: ProjectAssessment,
  feedback: PostLaunchFeedback
): Promise<void> {
  let msg = `**${snapshot.name}** 📊 Post-Launch\n\n`;
  
  // Acknowledge traction
  if (feedback.tractionSignal) {
    msg += `${feedback.tractionSignal} is solid signal.\n\n`;
  }
  
  // Acknowledge feature request
  if (feedback.featureRequest) {
    // Escape markdown special chars in user input
    const safeFeature = feedback.featureRequest.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    msg += `Users want: ${safeFeature}\n\n`;
  }
  
  // Add cursor prompt if generated
  if (assessment.artifacts.cursorPrompt) {
    msg += `**Cursor Prompt:**\n\n${assessment.artifacts.cursorPrompt}\n\n`;
  }
  
  msg += `Want me to draft a follow-up post about this update?`;
  
  const keyboard = new InlineKeyboard()
    .text('📣 Draft Follow-up', `followup:${snapshot.name}`)
    .row()
    .text('😴 Snooze 24h', `snooze:${snapshot.name}`)
    .text('✅ Done', `done:${snapshot.name}`);
  
  await bot.api.sendMessage(chatIdToSend, msg, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

// ============ MESSAGE HANDLER ============

bot.on('message:text', async (ctx) => {
  const userMessage = ctx.message.text;
  const userId = ctx.from?.id.toString();

  if (userId !== chatId) return;
  if (userMessage.startsWith('/')) return;

  // Record message
  await stateManager.addConversationMessage({
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString(),
  });

  // Get active project
  const activeProject = await stateManager.getActiveProject();
  
  if (!activeProject) {
    await ctx.reply("No active project. Use /check to analyze your repos first.");
    return;
  }

  // Get cached snapshot
  const snapshot = await stateManager.getSnapshot(activeProject);
  if (!snapshot) {
    await ctx.reply("Project context expired. Running /check...");
    // Trigger check
    return;
  }

  // Get project state to check if launched
  const projectState = await stateManager.getProjectState(activeProject);
  const isLaunched = projectState?.status === 'launched' || !!projectState?.launchedAt;

  // Parse feedback only if project is launched
  if (isLaunched) {
    const feedback = parsePostLaunchFeedback(userMessage);
    
    if (feedback.hasFeedback) {
      // Create user_reply evidence
      const userReplyEvidence: EvidenceRef = {
        kind: 'user_reply',
        excerpt: feedback.rawExcerpt,
        tractionSignal: feedback.tractionSignal || undefined,
        featureRequest: feedback.featureRequest || undefined,
      };
      
      // Route through reasoner with feedback context
      const assessment = await reasoner.analyzeWithFeedback(
        snapshot,
        await profileManager.getUserProfile(),
        feedback
      );
      
      // Ensure evidence is attached
      if (assessment.primaryShortcoming) {
        assessment.primaryShortcoming.evidence.push(userReplyEvidence);
      } else {
        // Create a shortcoming if none exists, just to hold the evidence
        assessment.primaryShortcoming = {
          issue: 'User feedback received',
          severity: 'minor',
          evidence: [userReplyEvidence],
          impact: 'User is providing post-launch feedback',
        };
      }
      
      // Send through standard pipeline
      await sendPostLaunchResponse(ctx.chat!.id.toString(), snapshot, assessment, feedback);
      
      await stateManager.addConversationMessage({
        role: 'assistant',
        content: 'Post-launch feedback processed',
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }

  // Get conversation history for context
  const conversationHistory = await stateManager.getRecentConversation(10);
  const historyForReasoner: ConversationMessage[] = conversationHistory.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Collect all project snapshots for context
  const allSnapshots = await collector.collectTopProjects(10);
  
  // Use AI to understand the message intent
  const understanding = await reasoner.understandMessage(
    userMessage,
    historyForReasoner,
    allSnapshots,
    activeProject
  );

  const userProfile = await profileManager.getUserProfile();

  // Handle based on intent
  switch (understanding.intent) {
    case 'question': {
      // Direct response to questions
      if (understanding.directResponse) {
        await ctx.reply(understanding.directResponse, { parse_mode: 'Markdown' });
        await stateManager.addConversationMessage({
          role: 'assistant',
          content: understanding.directResponse,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    case 'artifact_request':
    case 'confirmation': {
      // Generate the requested artifact
      const assessment = await reasoner.analyze(snapshot, userProfile);
      let response: string | null = null;

      switch (understanding.artifactType) {
        case 'cursor_prompt':
          response = assessment.artifacts.cursorPrompt 
            ? `**Cursor Prompt:**\n\n${assessment.artifacts.cursorPrompt}`
            : null;
          break;
        case 'launch_post':
          response = assessment.artifacts.launchPost
            ? `**Launch Post:**\n\n${assessment.artifacts.launchPost}`
            : null;
          break;
        case 'landing_copy':
          response = assessment.artifacts.landingCopy
            ? `**Landing Copy:**\n\n${assessment.artifacts.landingCopy}`
            : null;
          break;
        case 'env_checklist':
          response = assessment.artifacts.envChecklist;
          break;
      }

      if (response) {
        await ctx.reply(response, { parse_mode: 'Markdown' });
        await stateManager.addConversationMessage({
          role: 'assistant',
          content: response,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Fallback: send whatever artifact is available
        const artifactMessage = formatArtifactMessage(assessment);
        if (artifactMessage) {
          await ctx.reply(artifactMessage, { parse_mode: 'Markdown' });
          await stateManager.addConversationMessage({
            role: 'assistant',
            content: artifactMessage,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return;
    }

    case 'unclear':
    default: {
      // Provide helpful guidance
      const response = understanding.directResponse || 
        `What would you like to do with **${activeProject}**?\n\n• "prompt" → Cursor prompt\n• "post" → Launch post\n• "copy" → Landing copy\n• /status → See all projects`;
      await ctx.reply(response, { parse_mode: 'Markdown' });
      await stateManager.addConversationMessage({
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }
});

// ============ WEBHOOK HANDLER ============

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const update = await req.json() as Update;
    
    const debugInfo = {
      updateType: update.message ? 'message' : update.callback_query ? 'callback' : 'other',
      fromId: update.message?.from?.id || update.callback_query?.from?.id,
      expectedChatId: chatId,
      text: update.message?.text?.substring(0, 50) || update.callback_query?.data,
    };
    console.log('Telegram update:', JSON.stringify(debugInfo));
    
    await bot.handleUpdate(update);
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
