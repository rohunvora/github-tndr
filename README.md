# Relentless Project Pusher

An autonomous Telegram bot that tracks your GitHub repos and pushes you to **LAUNCH** them - not just code them. Built for builders who start tons of projects but never ship.

## The Problem This Solves

You create potential gems but:
- Get distracted and start new things
- Never validate if ideas are actually good
- Have a graveyard of "almost done" repos
- Code is "finished" but nothing is live

## What It Does

- **Tracks** all your GitHub repos and their LAUNCH status (not just code status)
- **Pings you** 5-10x daily pushing toward GTM, not just commits
- **Asks** "Is this live?" "Who's using it?" "What's the URL?"
- **Challenges** you when you start new things before shipping old ones
- **Celebrates** launches and user feedback, not commits

## Setup

### 1. Prerequisites

- Node.js 18+
- Vercel account
- Telegram account
- GitHub account with repos
- Anthropic API key (for Claude)

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
USER_TELEGRAM_CHAT_ID=your_telegram_chat_id_here

# GitHub
GITHUB_TOKEN=your_github_personal_access_token_here
GITHUB_WEBHOOK_SECRET=your_webhook_secret_optional

# Vercel
VERCEL_TOKEN=your_vercel_token_here
VERCEL_TEAM_ID=your_team_id_optional

# Anthropic Claude
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Vercel KV (set these in Vercel dashboard after creating KV store)
KV_URL=your_kv_url_here
KV_REST_API_URL=your_kv_rest_api_url_here
KV_REST_API_TOKEN=your_kv_rest_api_token_here
```

### 4. Get Your Telegram Bot Token

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy the bot token to `TELEGRAM_BOT_TOKEN`

### 5. Get Your Telegram Chat ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. Copy your ID to `USER_TELEGRAM_CHAT_ID`

### 6. Get GitHub Token

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Create token with `repo` scope
3. Copy to `GITHUB_TOKEN`

### 7. Get Vercel Token

1. Go to Vercel Settings → Tokens
2. Create a new token
3. Copy to `VERCEL_TOKEN`

### 8. Set Up Vercel KV

1. In Vercel dashboard, go to Storage → Create Database → KV
2. Copy the connection details to your `.env`

### 9. Deploy to Vercel

```bash
vercel
```

Follow the prompts. Make sure to add all environment variables in the Vercel dashboard.

### 10. Configure Telegram Webhook

After deployment, set your webhook URL:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://your-vercel-app.vercel.app/api/telegram"
```

### 11. Configure GitHub Webhook

For each repo you want to track:

1. Go to repo Settings → Webhooks → Add webhook
2. Payload URL: `https://your-vercel-app.vercel.app/api/github-webhook`
3. Content type: `application/json`
4. Secret: (optional, use `GITHUB_WEBHOOK_SECRET`)
5. Events: Select "Just the push event"
6. Active: ✓

### 12. Configure Vercel Webhook

1. Go to Vercel Settings → Webhooks
2. Add webhook: `https://your-vercel-app.vercel.app/api/vercel-webhook`
3. Events: Select "Deployment Created", "Deployment Ready", "Deployment Error"

## Commands

| Command | What It Does |
|---------|--------------|
| `/status` | Get current status of all projects |
| `/focus <project>` | Lock in on one project - bot will be relentless |
| `/launched <project> <url>` | Mark a project as launched (share where you posted it) |
| `/feedback <project> <text>` | Record user feedback (3 feedbacks = validated) |

## Message Schedule

The bot will ping you at:
- **8:00 AM** - Morning briefing: What needs to ship?
- **1:00 PM** - Midday check: Did you launch anything?
- **5:00 PM** - Afternoon push: Stop coding, start shipping
- **9:00 PM** - Evening recap: What shipped? What's tomorrow's launch?

Plus real-time notifications for:
- New commits → "Good, now deploy it"
- Deployments → "It's live. Who are you sending it to?"
- User replies → Accountability follow-ups

## How It Works

1. **Cron jobs** sync project states and generate proactive messages
2. **GitHub webhooks** trigger on commits - bot reacts immediately
3. **Vercel webhooks** trigger on deployments - bot sends preview links
4. **User messages** are processed with full context and memory
5. **AI agent** uses Claude to generate contextual, demanding responses

## Development

```bash
# Run locally
npm run dev

# Type check
npm run type-check
```

## Architecture

- **Vercel Functions** - Serverless API endpoints
- **Vercel KV** - State and conversation memory
- **Claude API** - AI brain
- **Telegram Bot API** - Communication
- **GitHub API** - Repo monitoring
- **Vercel API** - Deployment tracking

## License

MIT
