<div align="center">
  <img src="/.github/social-preview.png" alt="github-tndr" width="800" />
  <p><strong>AI-powered Telegram bot that analyzes your GitHub repos and tells you whether to ship, focus, or kill each project</strong></p>
  <p>
    <a href="https://github-tndr.vercel.app"><strong>🚀 Live Demo</strong></a>
    ·
    <a href="LICENSE">MIT License</a>
  </p>
</div>

# Ship or Kill Bot 🚀☠️

**AI-powered Telegram bot that analyzes your GitHub repos and tells you whether to ship, focus, or kill each project.**

Stop letting half-finished projects rot in your GitHub. This bot scans your repositories, identifies what's actually valuable, and gives you brutally honest recommendations: ship it as-is, cut to the core feature, or kill it entirely.

## Commands

### 📊 Analysis
| Command | Description |
|---------|-------------|
| `/repo <name>` | Analyze a GitHub repo (ship/cut/kill verdict) |
| `/scan` | Batch analyze all repos from last N days |
| **Send photo** | Analyze chart image for support/resistance zones |

### 🎨 Generation
| Command | Description |
|---------|-------------|
| `/preview <repo>` | Generate cover image → approve → add to README |
| `/readme <repo>` | Generate/optimize README |

### 🎴 Feed
| Command | Description |
|---------|-------------|
| `/next` | Carousel of active projects — pick what to work on |
| `/status` | See repo counts by state |

## How It Works

```
You: /scan

Bot: 🔍 Scanning...
     ████████░░ 80%
     📂 crypto-dashboard
     🟢2 🟡3 🔴1 ☠️1

Bot: ✅ Scan Complete (8 repos)
     
     🟢 Ready to Ship (2)
       • github-tndr
       • bel-rtr
     
     🟡 Cut to Core (3)
       • crypto-dashboard
       • habit-tracker
       • note-app

You: /repo crypto-dashboard

Bot: ━━━ crypto-dashboard ━━━
     🟡 CUT TO CORE
     
     Real-time portfolio tracker with clean charts
     
     ⚠️ README ≠ code: Claims "social features" but...
     
     → Delete: NewsFeed.tsx, SocialStream.tsx (+3)
     
     Pride: 🟡 comfortable (2 blockers)
     
     [✂️ Cut] [☠️ Kill] [📋 More]
```

## Plugin Architecture

Each tool is **isolated** — tweak one without breaking others:

```
lib/
├── core/                    # Shared infrastructure
│   ├── config.ts            # AI providers, env vars
│   ├── github.ts            # GitHub API client
│   ├── state.ts             # Vercel KV state
│   └── types.ts             # Shared types
│
└── tools/                   # Self-contained tools
    ├── chart/               # Photo → chart analysis
    ├── repo/                # /repo command
    ├── scan/                # /scan command
    ├── preview/             # /preview command
    ├── readme/              # /readme command
    └── next/                # /next carousel
```

See [plugin-architecture.md](.cursor/plans/plugin-architecture.md) for full details.

## Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/yourusername/github-tndr
   cd github-tndr
   npm install
   ```

2. **Environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Fill in:
   - `TELEGRAM_BOT_TOKEN` - Get from [@BotFather](https://t.me/botfather)
   - `ANTHROPIC_API_KEY` - Get from [Anthropic Console](https://console.anthropic.com)
   - `GOOGLE_AI_KEY` - Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - `GITHUB_TOKEN` - Personal access token with repo read permissions
   - `KV_*` - Vercel KV database credentials

3. **Deploy**
   ```bash
   vercel deploy
   ```

4. **Set webhook**
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{"url": "https://your-app.vercel.app/api/telegram"}'
   ```

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Bot Framework**: Grammy (Telegram Bot API)
- **AI**: Anthropic Claude (analysis) + Google Gemini (vision, image gen)
- **Database**: Vercel KV (Redis)
- **Deployment**: Vercel Edge Functions

## Contributing

See [SETUP.md](SETUP.md) for detailed development setup instructions.
