export const config = {
  runtime: 'edge',
};

import { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { Agent } from '../lib/agent.js';
import { stateManager } from '../lib/state.js';

// Generate botInfo dynamically from token (token format: BOT_ID:SECRET)
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

const agent = new Agent(
  process.env.ANTHROPIC_API_KEY!,
  process.env.GITHUB_TOKEN!,
  process.env.VERCEL_TOKEN!,
  process.env.VERCEL_TEAM_ID
);

// Handle special commands
bot.command('launched', async (ctx) => {
  const text = ctx.message?.text || ctx.msg?.text || '';
  const args = text.split(' ').slice(1);
  const projectName = args[0];
  const launchUrl = args[1];
  
  if (!projectName) {
    await ctx.reply('Usage: /launched <project-name> <launch-url>\nExample: /launched my-app https://twitter.com/me/status/123');
    return;
  }
  
  const existing = await stateManager.getProjectState(projectName);
  if (existing) {
    await stateManager.setProjectState(projectName, {
      ...existing,
      status: 'launched',
      launchedAt: new Date().toISOString(),
      launchUrl: launchUrl || null,
    });
    await ctx.reply(`🚀 **${projectName}** marked as LAUNCHED! Now go get feedback. Who's the first person you're sending this to?`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(`Project "${projectName}" not found. Check the name and try again.`);
  }
});

bot.command('feedback', async (ctx) => {
  const text = ctx.message?.text || ctx.msg?.text || '';
  const args = text.split(' ').slice(1);
  const projectName = args[0];
  const feedback = args.slice(1).join(' ');
  
  if (!projectName || !feedback) {
    await ctx.reply('Usage: /feedback <project-name> <user feedback>\nExample: /feedback my-app "User said the signup was confusing"');
    return;
  }
  
  const existing = await stateManager.getProjectState(projectName);
  if (existing) {
    const userFeedback = existing.userFeedback || [];
    userFeedback.push(`${new Date().toISOString().split('T')[0]}: ${feedback}`);
    await stateManager.setProjectState(projectName, {
      ...existing,
      userFeedback,
      status: userFeedback.length >= 3 ? 'validated' : existing.status,
    });
    await ctx.reply(`📝 Feedback recorded for **${projectName}**. ${userFeedback.length}/3 feedback points. ${userFeedback.length >= 3 ? 'Project is now VALIDATED!' : 'Keep collecting feedback.'}`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(`Project "${projectName}" not found.`);
  }
});

bot.command('status', async (ctx) => {
  try {
    const response = await agent.generateMessage({
      trigger: 'user_reply',
      userMessage: 'Quick status check - what should I focus on right now?',
    });
    await ctx.reply(response, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Status error:', error);
    await ctx.reply("Couldn't fetch status. Try again or just tell me what you're working on.");
  }
});

bot.command('focus', async (ctx) => {
  const text = ctx.message?.text || ctx.msg?.text || '';
  const args = text.split(' ').slice(1);
  const projectName = args[0];
  
  if (!projectName) {
    await ctx.reply('Usage: /focus <project-name>\nThis tells me to prioritize pushing you on this specific project.');
    return;
  }
  
  await stateManager.addCommitment({
    date: new Date().toISOString().split('T')[0],
    text: `FOCUS: Ship ${projectName}`,
    project: projectName,
  });
  
  await ctx.reply(`🎯 Locked in on **${projectName}**. I'll be relentless about this one until it ships. What's the ONE thing blocking launch?`, { parse_mode: 'Markdown' });
});

bot.command('start', async (ctx) => {
  await ctx.reply(`Hey. I'm your project pusher. I track all your GitHub repos and push you to actually SHIP them, not just code them.

Commands:
/status - See all your projects
/focus <project> - Lock in on one project
/launched <project> <url> - Mark something shipped
/feedback <project> <text> - Record user feedback

Or just talk to me. I'll push you to launch.`);
});

// Handle regular messages
bot.on('message:text', async (ctx) => {
  const userMessage = ctx.message.text;
  const userId = ctx.from?.id.toString();

  // Only respond to the configured user
  if (userId !== chatId) {
    return;
  }

  // Skip if it's a command (already handled above)
  if (userMessage.startsWith('/')) {
    return;
  }

  // Add user message to conversation history
  await stateManager.addConversationMessage({
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString(),
  });

  // Extract commitments from user message (simple pattern matching)
  const commitmentPatterns = [
    /(?:I'll|I will|going to|gonna)\s+(.+?)(?:today|tomorrow|this week)/i,
    /(?:commit to|promise to)\s+(.+)/i,
    /(?:shipping|launching|deploying)\s+(\w+)/i,
  ];

  for (const pattern of commitmentPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const projectMatch = userMessage.match(/\b([a-z][\w-]*)\b/i);
      const project = projectMatch ? projectMatch[1] : 'general';
      
      await stateManager.addCommitment({
        date: new Date().toISOString().split('T')[0],
        text: match[1].trim(),
        project,
      });
    }
  }

  // Generate response
  const response = await agent.generateMessage({
    trigger: 'user_reply',
    userMessage,
  });

  // Send response
  await ctx.reply(response, { parse_mode: 'Markdown' });

  // Add assistant message to conversation history
  await stateManager.addConversationMessage({
    role: 'assistant',
    content: response,
    timestamp: new Date().toISOString(),
  });
});

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const update = await req.json() as Update;
    
    // Debug logging
    const debugInfo = {
      updateType: update.message ? 'message' : 'other',
      fromId: update.message?.from?.id,
      expectedChatId: chatId,
      text: update.message?.text?.substring(0, 50),
    };
    console.log('Telegram update:', JSON.stringify(debugInfo));
    
    await bot.handleUpdate(update);
    
    return new Response(JSON.stringify({ success: true, debug: debugInfo }), {
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
