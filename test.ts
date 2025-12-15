/**
 * Test script for the Project Pusher bot
 * Simulates Telegram webhook calls and shows responses
 * 
 * Usage: npx tsx test.ts
 */

const WEBHOOK_URL = 'https://github-tndr.vercel.app/api/telegram';
const BOT_TOKEN = '8243228118:AAEV8FSKTDHSVYHI3x9LcnatLDjRocHgKio';
const CHAT_ID = 2105556647;

interface TelegramUpdate {
  update_id: number;
  message: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text: string;
  };
}

async function sendTestMessage(text: string): Promise<void> {
  const updateId = Math.floor(Math.random() * 1000000);
  const messageId = Math.floor(Math.random() * 1000000);
  
  const update: TelegramUpdate = {
    update_id: updateId,
    message: {
      message_id: messageId,
      from: {
        id: CHAT_ID,
        is_bot: false,
        first_name: 'Test',
      },
      chat: {
        id: CHAT_ID,
        type: 'private',
      },
      date: Math.floor(Date.now() / 1000),
      text: text,
    },
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📤 SENDING: "${text}"`);
  console.log(`${'='.repeat(60)}`);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(update),
    });

    const responseText = await response.text();
    console.log(`\n📥 WEBHOOK RESPONSE (${response.status}):`);
    console.log(responseText);

    if (!response.ok) {
      console.log(`\n❌ ERROR: ${response.status} ${response.statusText}`);
    }

    // Wait a moment for the bot to process and send response
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check what the bot sent back via Telegram API
    await checkBotResponse();

  } catch (error) {
    console.log(`\n❌ FETCH ERROR:`, error);
  }
}

async function checkBotResponse(): Promise<void> {
  try {
    // Get recent updates to see if bot responded
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1&limit=5`
    );
    const data = await response.json();
    
    if (data.ok && data.result.length > 0) {
      console.log(`\n📬 RECENT TELEGRAM ACTIVITY:`);
      for (const update of data.result.slice(-2)) {
        if (update.message) {
          const msg = update.message;
          const from = msg.from?.first_name || 'Unknown';
          console.log(`  [${from}]: ${msg.text?.substring(0, 100)}...`);
        }
      }
    }
  } catch (error) {
    // Ignore errors here
  }
}

async function checkVercelLogs(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 Checking Vercel function logs...`);
  console.log(`${'='.repeat(60)}`);
  
  // We'll use the Vercel API to check logs
  const vercelToken = '9VYVciS6MHWrX4iNCn1OYdxs';
  
  try {
    const response = await fetch(
      'https://api.vercel.com/v2/deployments?projectId=github-tndr&limit=1',
      {
        headers: {
          Authorization: `Bearer ${vercelToken}`,
        },
      }
    );
    const data = await response.json();
    
    if (data.deployments && data.deployments[0]) {
      const deployment = data.deployments[0];
      console.log(`Latest deployment: ${deployment.url}`);
      console.log(`State: ${deployment.state}`);
      console.log(`Created: ${new Date(deployment.created).toISOString()}`);
    }
  } catch (error) {
    console.log(`Could not fetch deployment info`);
  }
}

async function runTests(): Promise<void> {
  console.log(`\n🧪 PROJECT PUSHER BOT - TEST SUITE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
  console.log(`Chat ID: ${CHAT_ID}`);
  console.log(`${'='.repeat(60)}`);

  // Test 1: /start command
  await sendTestMessage('/start');
  
  // Test 2: Simple message
  await sendTestMessage('hi');
  
  // Test 3: /status command
  await sendTestMessage('/status');

  // Check logs
  await checkVercelLogs();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ TEST COMPLETE`);
  console.log(`${'='.repeat(60)}`);
}

// Run tests
runTests().catch(console.error);

