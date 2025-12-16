# Ship or Kill Bot 🚀☠️

A Telegram bot that helps you blast through your half-finished repos and decide: **ship it**, **cut to core**, or **kill it**.

## The Problem

You start lots of projects but don't finish them. The last 10% is the hardest:
- Unclear what "done" looks like
- Scope creep during vibecoding
- High bar makes nothing feel ready

## The Solution

A sharp analyst in your Telegram that:
- Scans your repos and finds the **core value** (if any)
- Gives honest verdicts: ship, cut to core, no core, dead
- Generates **paste-ready Cursor prompts** for refactoring
- Drafts **tweets** when you're ready to launch
- Tracks decisions so repos don't rot in limbo

## Commands

| Command | What it does |
|---------|--------------|
| `/scan` | Analyze repos from last 10 days |
| `/scan 30` | Analyze repos from last 30 days |
| `/status` | See counts by state (ready, dead, shipped, etc.) |
| `/repo <name>` | Deep dive on one specific repo |

## The Flow

```
You: /scan

Bot: ⏳ Analyzing 8 repos...

Bot: [1/8] ━━━ crypto-dashboard ━━━
Three products jammed into one: portfolio tracker, news feed, social stream.
Core: The real-time portfolio chart (clean UI, live updates)
Cut: NewsFeed.tsx, SocialStream.tsx, news-api.ts, social.ts
Verdict: Cut to core
[Cut to core] [Ship as-is] [Kill]

You: [Cut to core]

Bot: Here's the Cursor prompt:
┌─────────────────────────────────────────────────┐
│ Refactor crypto-dashboard to its core           │
│                                                 │
│ Delete:                                         │
│ - components/NewsFeed.tsx                       │
│ - components/SocialStream.tsx                   │
│ - lib/news-api.ts                               │
│                                                 │
│ Acceptance: App loads with only portfolio view. │
└─────────────────────────────────────────────────┘

Reply "done" when you've pushed.

You: done

Bot: [crypto-dashboard] ━━━ Ready to ship! ━━━
Deploy: 🟢 Green
Tweet: "real-time portfolio tracker. no login. crypto-dashboard.vercel.app"
[Post this] [Edit tweet] [Not yet]
```

## Setup

1. Create a Telegram bot via [@BotFather](https://t.me/botfather)
2. Get your chat ID via [@userinfobot](https://t.me/userinfobot)
3. Set environment variables:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
USER_TELEGRAM_CHAT_ID=your_chat_id
GITHUB_TOKEN=your_github_pat
ANTHROPIC_API_KEY=your_anthropic_key
KV_REST_API_URL=your_vercel_kv_url
KV_REST_API_TOKEN=your_vercel_kv_token
```

4. Deploy to Vercel
5. Set webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-app.vercel.app/api/telegram`

## Tech Stack

- **Vercel** - Edge functions
- **Grammy** - Telegram bot framework
- **Anthropic Claude** - Repo analysis
- **Vercel KV** - State storage
- **GitHub API** - Repo data

## Repo States

| State | Meaning |
|-------|---------|
| `ready` | Ready to ship (deploy green, tweet drafted) |
| `has_core` | Has a valuable core, needs work to focus it |
| `no_core` | Analyzed, no clear value found |
| `dead` | Killed by user decision |
| `shipped` | Launched! |
| `analyzing` | Analysis in progress |

## License

MIT
