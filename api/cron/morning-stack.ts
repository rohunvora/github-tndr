export const config = {
  runtime: 'edge',
  maxDuration: 60,
};

import Anthropic from '@anthropic-ai/sdk';
import { stateManager } from '../../lib/state.js';
import { GitHubClient } from '../../lib/github.js';
import { generateCard, getFeedMemory, calculatePriority } from '../../lib/card-generator.js';
import { formatMorningStack } from '../../lib/bot/format.js';
import { morningStackKeyboard } from '../../lib/bot/keyboards.js';
import { TrackedRepo, RepoCard } from '../../lib/core-types.js';

// Send message to Telegram
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

/**
 * Morning Stack Cron Job
 * 
 * Runs daily at 9am (configured in vercel.json)
 * Sends 1-3 top priority cards as the morning stack
 */
export default async function handler(req: Request) {
  // Only allow GET (Vercel cron) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const chatId = process.env.USER_TELEGRAM_CHAT_ID?.trim();
  if (!chatId) {
    return new Response(JSON.stringify({ error: 'No chat ID configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Get all tracked repos
    const repos = await stateManager.getAllTrackedRepos();
    if (repos.length === 0) {
      await sendTelegramMessage(
        chatId,
        '☀️ **Good morning!**\n\nNo repos tracked yet. Use /scan to analyze your repos.',
        { inline_keyboard: [[{ text: '🔍 Scan Repos', callback_data: 'quickscan' }]] }
      );
      return new Response(JSON.stringify({ success: true, action: 'no_repos' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Filter out shipped/dead repos
    const activeRepos = repos.filter(r => r.state !== 'shipped' && r.state !== 'dead');
    if (activeRepos.length === 0) {
      await sendTelegramMessage(
        chatId,
        '☀️ **Good morning!**\n\n🎉 All your repos are either shipped or cleared!\n\nUse /scan to find new projects to work on.',
        { inline_keyboard: [[{ text: '🔍 Scan Repos', callback_data: 'quickscan' }]] }
      );
      return new Response(JSON.stringify({ success: true, action: 'all_complete' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Initialize clients
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const github = new GitHubClient(process.env.GITHUB_TOKEN!);

    // Get feed memory and calculate priorities
    const memory = await getFeedMemory();
    const prioritized = activeRepos
      .map(repo => ({ repo, priority: calculatePriority(repo, memory) }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3); // Top 3

    if (prioritized.length === 0) {
      await sendTelegramMessage(
        chatId,
        '☀️ **Good morning!**\n\nNo high-priority tasks today. Use /next when you\'re ready to work.',
        morningStackKeyboard()
      );
      return new Response(JSON.stringify({ success: true, action: 'no_priority' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Generate cards for top repos
    const cards: RepoCard[] = [];
    for (const { repo } of prioritized) {
      try {
        const card = await generateCard(anthropic, github, repo);
        cards.push(card);
      } catch (error) {
        console.error(`Failed to generate card for ${repo.name}:`, error);
      }
    }

    if (cards.length === 0) {
      await sendTelegramMessage(
        chatId,
        '☀️ **Good morning!**\n\n⚠️ Couldn\'t generate cards. Use /next to try again.',
        morningStackKeyboard()
      );
      return new Response(JSON.stringify({ success: true, action: 'card_gen_failed' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send ONE consolidated message with all cards
    await sendTelegramMessage(
      chatId,
      formatMorningStack(cards),
      morningStackKeyboard()
    );

    return new Response(JSON.stringify({
      success: true,
      action: 'morning_stack_sent',
      cards_sent: cards.length,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Morning stack error:', error);
    
    // Try to notify user of error
    try {
      await sendTelegramMessage(
        chatId,
        `☀️ **Good morning!**\n\n⚠️ Had trouble preparing your stack. Use /next to get started.`,
        morningStackKeyboard()
      );
    } catch {
      // Ignore notification failure
    }

    return new Response(JSON.stringify({ 
      error: String(error),
      action: 'error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
