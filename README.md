# Telegram AI Bot Framework

Modular Telegram bot with pluggable tools, multi-provider AI (Claude + Gemini), and a testable skills layer.

## Architecture

```
Telegram API
     │
     ▼
Tool Registry ─────────────────────────────────
  │ repo │ scan │ preview │ readme │ next │ ...
  └──────┴──────┴─────────┴────────┴──────┘
     │
     ▼
Skills Layer
  • Dependency injection (GitHub, AI, KV, Telegram)
  • Progress tracking
  • Session management
  • Testable without mocking Telegram
     │
     ▼
AI Providers
  ┌─────────────┐  ┌─────────────┐
  │  Anthropic  │  │   Google    │
  │  (Claude)   │  │  (Gemini)   │
  └─────────────┘  └─────────────┘
```

**Key ideas:**
- Tools handle commands/messages/callbacks — no business logic in bot handlers
- Skills wrap tools with dependency injection — testable without Telegram
- Multi-provider AI — Claude for reasoning, Gemini for vision/images

## Quick Start

```bash
git clone https://github.com/yourusername/telegram-ai-bot
cd telegram-ai-bot
npm install

cp .env.example .env.local
# Add API keys

vercel deploy

curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://your-app.vercel.app/api/telegram"}'
```

## Creating a Tool

Tools are self-contained. Each declares what it handles.

```typescript
// lib/tools/hello/index.ts
import type { Tool } from '../types.js';

export const helloTool: Tool = {
  name: 'hello',
  version: '1.0.0',
  description: 'Greeting tool',

  commands: [
    {
      name: 'hello',
      description: 'Say hello',
      handler: async (ctx, args) => {
        await ctx.reply(`Hello, ${args || 'World'}!`);
      },
    },
  ],

  // Handle photos
  messageHandlers: [
    {
      type: 'photo',
      priority: 10,
      handler: async (ctx) => {
        await ctx.reply('Got your photo');
      },
    },
  ],

  // Handle button callbacks
  callbackHandlers: [
    {
      pattern: 'hello:',
      handler: async (ctx, data) => {
        await ctx.answerCallbackQuery({ text: data });
      },
    },
  ],
};
```

Register in `lib/tools/index.ts`. The registry routes automatically.

## Creating a Skill

Skills add testability via dependency injection.

```typescript
// lib/skills/hello/index.ts
import type { Skill, SkillContext, SkillResult } from '../_shared/types.js';

interface HelloInput { name: string }
interface HelloOutput { greeting: string }

export const helloSkill: Skill<HelloInput, HelloOutput> = {
  name: 'hello',
  description: 'Generate greeting with AI',
  dependencies: ['anthropic'],

  async run(input, ctx): Promise<SkillResult<HelloOutput>> {
    const response = await ctx.anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: `Greet ${input.name}` }],
    });

    return {
      success: true,
      data: { greeting: response.content[0].text },
    };
  },
};
```

Test without real API calls:

```typescript
const ctx = createTestContext(); // Mocks injected
const result = await helloSkill.run({ name: 'Test' }, ctx);
```

## Project Structure

```
lib/
├── core/           # Config, GitHub client, KV state, types
├── tools/          # Command handlers (one dir per tool)
│   ├── types.ts    # Tool interface
│   ├── registry.ts # Auto-routing
│   └── repo/       # Example: GitHub repo analyzer
├── skills/         # Testable wrappers (one dir per skill)
│   ├── _shared/    # Skill interface, context, progress
│   └── repo/       # Example: repo analysis skill
├── ai/             # Single-purpose AI functions
└── bot/            # Telegram formatting, keyboards

api/
├── telegram.ts     # Main webhook
└── health.ts       # Status endpoint
```

## Built-in Tools

Examples demonstrating different patterns:

| Command | Pattern | What it does |
|---------|---------|--------------|
| `/repo <name>` | Command + cache | Analyze GitHub repo with Claude |
| `/scan` | Batch + progress | Scan multiple repos |
| `/preview <repo>` | Generation + session | Generate cover image with Gemini |
| `/readme <repo>` | Generation | Generate README with Claude |
| `/next` | Carousel | Interactive project picker |
| Photo | Message handler | Chart analysis with Gemini Vision |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `ANTHROPIC_API_KEY` | Yes | Claude API |
| `GOOGLE_AI_KEY` | No | Gemini (vision/image gen) |
| `GITHUB_TOKEN` | No | GitHub API |
| `KV_REST_API_*` | No | Vercel KV |

## Tech Stack

- Node.js + TypeScript
- Grammy (Telegram)
- Anthropic Claude + Google Gemini
- Vercel KV (Redis)
- Vercel Edge Functions
- Zod

## Contributing

See [SETUP.md](SETUP.md) for dev setup.
