# Setup Guide - Relentless Project Pusher

## Current Status: Code Complete ✅

The bot is fully built and ready to deploy. You just need to:
1. Get API keys (5 min)
2. Deploy to Vercel (2 min)
3. Configure webhooks (2 min)

---

## Step 1: Get Your API Keys

### Telegram Bot Token
1. Open Telegram, message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Name: `Project Pusher` (or whatever you want)
4. Username: `yourname_pusher_bot` (must end in `bot`)
5. **Copy the token** it gives you

### Your Telegram Chat ID
1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It replies with your ID (a number like `123456789`)
3. **Copy this number**

### GitHub Personal Access Token
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Name: `project-pusher`
4. Select scopes: `repo` (full control)
5. Generate and **copy the token**

### Vercel Token
1. Go to [vercel.com/account/tokens](https://vercel.com/account/tokens)
2. Create new token, name it `project-pusher`
3. **Copy the token**

### Anthropic API Key
1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Create new key
3. **Copy the key**

---

## Step 2: Deploy to Vercel

```bash
cd /Users/satoshi/github-tndr

# Login to Vercel (opens browser)
npx vercel login

# Deploy (follow prompts)
npx vercel
```

When prompted:
- Set up and deploy? **Yes**
- Which scope? **Your account**
- Link to existing project? **No**
- Project name? **github-tndr** (or whatever)
- Directory? **./** (default)

### Add Environment Variables

After first deploy, go to your Vercel dashboard:
1. Select the project
2. Settings → Environment Variables
3. Add these:

| Name | Value |
|------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `USER_TELEGRAM_CHAT_ID` | Your chat ID from userinfobot |
| `GITHUB_TOKEN` | Your GitHub personal access token |
| `VERCEL_TOKEN` | Your Vercel token |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

4. Redeploy: `npx vercel --prod`

---

## Step 3: Create Vercel KV Store

1. In Vercel dashboard, go to your project
2. Click **Storage** tab
3. Click **Create Database** → **KV**
4. Name it `project-pusher-kv`
5. Click **Create**
6. It auto-adds the KV environment variables to your project

---

## Step 4: Set Telegram Webhook

Replace `YOUR_BOT_TOKEN` and `YOUR_VERCEL_URL` and run:

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_VERCEL_URL/api/telegram"
```

Example:
```bash
curl "https://api.telegram.org/bot123456:ABC-DEF/setWebhook?url=https://github-tndr.vercel.app/api/telegram"
```

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

---

## Step 5: Test It!

1. Open Telegram
2. Message your bot: "What's my status?"
3. It should reply with your project overview

### Commands Available

| Command | What It Does |
|---------|--------------|
| `/status` | Get status of all your projects |
| `/focus <project>` | Lock in on one project to ship |
| `/launched <project> <url>` | Mark something as launched |
| `/feedback <project> <text>` | Record user feedback |

---

## Optional: Set Up GitHub Webhook (for commit notifications)

For each repo you want real-time notifications:

1. Go to repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://YOUR_VERCEL_URL/api/github-webhook`
3. Content type: `application/json`
4. Events: Just the push event
5. Active: ✓

---

## Optional: Set Up Vercel Webhook (for deploy notifications)

1. Vercel dashboard → Settings → Webhooks
2. Add endpoint: `https://YOUR_VERCEL_URL/api/vercel-webhook`
3. Events: Deployment Created, Ready, Error

---

## Troubleshooting

### Bot not responding?
- Check webhook is set: `curl "https://api.telegram.org/botYOUR_TOKEN/getWebhookInfo"`
- Check Vercel logs: `npx vercel logs`

### "Unauthorized" errors?
- Make sure all env vars are set in Vercel dashboard
- Redeploy after adding env vars: `npx vercel --prod`

### KV errors?
- Make sure you created the KV store and it's linked to the project

---

## What the Bot Does

Once running, it will:
- **Ping you 4x daily** (8am, 1pm, 5pm, 9pm) about your projects
- **Track launch status** of all your GitHub repos
- **Push you to ship**, not just code
- **Remember your commitments** and follow up
- **React to commits** with "now deploy it"
- **React to deploys** with "who are you sending it to?"

The bot is brutally honest and won't let your projects rot. 🔥


