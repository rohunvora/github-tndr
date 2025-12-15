/**
 * Project Pusher - Test & Debug Console
 * 
 * Commands:
 *   npx tsx test.ts              - Run quick test
 *   npx tsx test.ts chat "msg"   - Send message, see response
 *   npx tsx test.ts logs [n]     - View last n messages (default 15)
 *   npx tsx test.ts export       - Export conversation to file
 *   npx tsx test.ts status       - Test /status command
 *   npx tsx test.ts test         - Run full test suite
 *   npx tsx test.ts interactive  - Interactive chat mode
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { config } from 'dotenv';

// Load .env file for local development
config();

// Configuration from environment
const BASE_URL = process.env.VERCEL_URL || 'https://github-tndr.vercel.app';
const WEBHOOK_URL = `${BASE_URL}/api/telegram`;
const CONVERSATIONS_URL = `${BASE_URL}/api/conversations`;
const CHAT_ID = parseInt(process.env.USER_TELEGRAM_CHAT_ID?.trim() || '0', 10);

if (!CHAT_ID) {
  console.error('\x1b[31mError: USER_TELEGRAM_CHAT_ID not set in .env file\x1b[0m');
  console.log('\nCreate a .env file with:\n  USER_TELEGRAM_CHAT_ID=your_chat_id\n');
  process.exit(1);
}

// Terminal colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
};

function print(color: string, ...args: unknown[]) {
  console.log(color, ...args, c.reset);
}

function printBox(title: string) {
  console.log('\n' + c.dim + '╔' + '═'.repeat(58) + '╗' + c.reset);
  console.log(c.dim + '║' + c.reset + c.bold + ` ${title.padEnd(56)} ` + c.dim + '║' + c.reset);
  console.log(c.dim + '╚' + '═'.repeat(58) + '╝' + c.reset);
}

interface ConversationData {
  recentMessages: Array<{ role: string; content: string; time: string }>;
  activeCommitments: Array<{ text: string; project: string; date: string }>;
  trackedProjects: number;
}

async function sendMessage(text: string): Promise<{ success: boolean; status: number; body: string }> {
  const update = {
    update_id: Math.floor(Math.random() * 1000000),
    message: {
      message_id: Math.floor(Math.random() * 1000000),
      from: { id: CHAT_ID, is_bot: false, first_name: 'Test' },
      chat: { id: CHAT_ID, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });

  return {
    success: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

async function getConversations(limit = 20): Promise<ConversationData> {
  const response = await fetch(`${CONVERSATIONS_URL}?limit=${limit}`);
  return response.json() as Promise<ConversationData>;
}

async function waitForResponse(waitMs = 4000): Promise<string | null> {
  await new Promise(r => setTimeout(r, waitMs));
  try {
    const data = await getConversations(2);
    const msgs = data.recentMessages;
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant') {
      return last.content;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ============================================
// COMMANDS
// ============================================

async function cmdChat(message: string) {
  printBox('CHAT');
  print(c.cyan, '\n👤 YOU:', message);
  console.log(c.dim + '─'.repeat(60) + c.reset);
  
  const result = await sendMessage(message);
  
  if (!result.success) {
    print(c.red, `❌ Error: ${result.status}`);
    return;
  }

  print(c.dim, '⏳ Waiting for response...');
  const botResponse = await waitForResponse(4000);
  
  if (botResponse) {
    print(c.green, '\n🤖 BOT:');
    console.log(botResponse);
  } else {
    print(c.yellow, '⚠️  Response not captured (check Telegram)');
  }
  console.log('');
}

async function cmdLogs(limit = 15) {
  printBox('CONVERSATION LOG');
  
  try {
    const data = await getConversations(limit);
    
    if (data.recentMessages.length === 0) {
      print(c.dim, '\nNo messages yet.\n');
      return;
    }

    console.log('');
    for (const msg of data.recentMessages) {
      const isUser = msg.role === 'user';
      const icon = isUser ? '👤' : '🤖';
      const label = isUser ? 'YOU' : 'BOT';
      const color = isUser ? c.cyan : c.green;
      
      print(c.dim, msg.time);
      print(color, `${icon} ${label}:`);
      console.log(msg.content);
      console.log('');
    }

    if (data.activeCommitments.length > 0) {
      console.log(c.dim + '─'.repeat(60) + c.reset);
      print(c.yellow, '\n📌 OPEN COMMITMENTS:');
      for (const commitment of data.activeCommitments) {
        console.log(`  • ${commitment.text} (${commitment.project})`);
      }
      console.log('');
    }

    print(c.dim, `📊 ${data.trackedProjects} projects tracked\n`);
  } catch (error) {
    print(c.red, 'Error:', error);
  }
}

async function cmdExport() {
  printBox('EXPORTING CONVERSATION');
  
  try {
    const data = await getConversations(100);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `conversation-${timestamp}.md`;
    
    let content = `# Project Pusher Conversation Log\n\n`;
    content += `Exported: ${new Date().toLocaleString()}\n`;
    content += `Projects Tracked: ${data.trackedProjects}\n\n`;
    content += `---\n\n`;
    
    for (const msg of data.recentMessages) {
      const label = msg.role === 'user' ? '**You**' : '**Bot**';
      content += `### ${label} (${msg.time})\n\n`;
      content += `${msg.content}\n\n`;
    }
    
    if (data.activeCommitments.length > 0) {
      content += `---\n\n## Open Commitments\n\n`;
      for (const c of data.activeCommitments) {
        content += `- ${c.text} (${c.project}) - ${c.date}\n`;
      }
    }
    
    fs.writeFileSync(filename, content);
    print(c.green, `\n✅ Exported to ${filename}\n`);
    print(c.dim, `${data.recentMessages.length} messages saved\n`);
  } catch (error) {
    print(c.red, 'Error:', error);
  }
}

async function cmdTest() {
  printBox('TEST SUITE');
  
  const tests = [
    { name: 'Start command', msg: '/start' },
    { name: 'Casual greeting', msg: 'hey there' },
    { name: 'Status check', msg: '/status' },
    { name: 'Ask for focus', msg: 'what should I work on today?' },
    { name: 'Make commitment', msg: "I'll ship the homepage by tonight" },
  ];

  for (const test of tests) {
    print(c.blue, `\n▶ ${test.name}`);
    print(c.dim, `  → "${test.msg}"`);
    
    const result = await sendMessage(test.msg);
    
    if (result.success) {
      print(c.green, `  ✓ OK`);
    } else {
      print(c.red, `  ✗ FAILED: ${result.body.substring(0, 80)}`);
    }
    
    await new Promise(r => setTimeout(r, 1500));
  }

  print(c.dim, '\n⏳ Waiting for responses...');
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('\n');
  await cmdLogs(12);
}

async function cmdInteractive() {
  printBox('INTERACTIVE MODE');
  print(c.dim, '\nType messages to chat with the bot.');
  print(c.dim, 'Commands: /logs, /export, /quit\n');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(c.cyan + '👤 You: ' + c.reset, async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        prompt();
        return;
      }
      
      if (trimmed === '/quit' || trimmed === '/exit') {
        print(c.dim, '\nGoodbye!\n');
        rl.close();
        return;
      }
      
      if (trimmed === '/logs') {
        await cmdLogs(10);
        prompt();
        return;
      }
      
      if (trimmed === '/export') {
        await cmdExport();
        prompt();
        return;
      }
      
      // Send message
      const result = await sendMessage(trimmed);
      
      if (!result.success) {
        print(c.red, `Error: ${result.status}`);
        prompt();
        return;
      }
      
      print(c.dim, '⏳ ...');
      const response = await waitForResponse(4000);
      
      if (response) {
        print(c.green, '\n🤖 Bot:');
        console.log(response + '\n');
      } else {
        print(c.yellow, 'No response captured\n');
      }
      
      prompt();
    });
  };
  
  prompt();
}

async function cmdQuick() {
  try {
    const data = await getConversations(5);
    console.log(c.dim + '\n─'.repeat(50) + c.reset);
    for (const msg of data.recentMessages.slice(-5)) {
      const icon = msg.role === 'user' ? '👤' : '🤖';
      const preview = msg.content.substring(0, 70) + (msg.content.length > 70 ? '...' : '');
      console.log(`${icon} ${preview}`);
    }
    console.log(c.dim + '─'.repeat(50) + c.reset + '\n');
  } catch (e) {
    print(c.red, 'Could not fetch');
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'quick';

  switch (cmd) {
    case 'chat':
    case 'send':
    case 'msg':
      const message = args.slice(1).join(' ') || 'hi';
      await cmdChat(message);
      break;
      
    case 'logs':
    case 'log':
    case 'history':
      await cmdLogs(parseInt(args[1]) || 15);
      break;
      
    case 'export':
    case 'save':
      await cmdExport();
      break;
      
    case 'interactive':
    case 'i':
    case 'repl':
      await cmdInteractive();
      break;

    case 'status':
      await cmdChat('/status');
      break;
      
    case 'test':
    case 'run':
    case 'suite':
      await cmdTest();
      break;
      
    case 'quick':
    case 'q':
    default:
      await cmdQuick();
      break;
  }
}

main().catch(console.error);
