# Plugin Architecture Plan

> Status: **READY TO BUILD** — Tool list finalized

## Overview

Restructure the codebase into a plugin-based architecture with **6 focused tools**. Each tool is isolated so you can tweak one without breaking others. Chart analysis syncs bidirectionally with bel-rtr.

## Final Tool List

### 📊 Analysis Tools

| Tool | Trigger | Description |
|------|---------|-------------|
| **repo** | `/repo <name>` | Analyze GitHub repo (ship/cut/kill verdict) |
| **chart** | Send any photo | Detect chart, analyze levels, annotate zones |
| **scan** | `/scan` | Batch analyze all your repos |

### 🎨 Generation Tools

| Tool | Trigger | Description |
|------|---------|-------------|
| **preview** | `/preview <repo>` | Generate cover image → approve/regen → add to README header |
| **readme** | `/readme <repo>` | Generate/optimize README |

### 🎴 Feed Tools

| Tool | Trigger | Description |
|------|---------|-------------|
| **next** | `/next` | Carousel of active projects with preview cards. Scrub through with ← → buttons to pick what to work on |

**Total: 6 commands** (plus photo detection for charts)

---

## Architecture

```
lib/
├── core/                    # Shared infrastructure
│   ├── config.ts            # AI providers, env vars
│   ├── github.ts            # GitHub API client
│   ├── state.ts             # Vercel KV state
│   ├── logger.ts            # Logging
│   └── types.ts             # Shared types
│
└── tools/                   # Each tool is isolated
    ├── types.ts             # Tool interface
    ├── registry.ts          # Auto-wires tools to bot
    │
    ├── repo/                # /repo - GitHub analysis
    │   ├── index.ts         # Tool definition
    │   ├── analyzer.ts      # Analysis logic
    │   ├── prompts.ts       # AI prompts
    │   └── format.ts        # Telegram formatting
    │
    ├── chart/               # Photo → chart analysis
    │   ├── index.ts         # Tool definition
    │   ├── analysis.ts      # Core logic (SYNCS with bel-rtr)
    │   ├── annotate.ts      # Image annotation (SYNCS)
    │   ├── types.ts         # Types (SYNCS)
    │   └── format.ts        # Telegram formatting (local)
    │
    ├── scan/                # /scan - batch analysis
    │   ├── index.ts
    │   └── handler.ts
    │
    ├── preview/             # /preview - cover image
    │   ├── index.ts
    │   ├── generator.ts     # Gemini image gen
    │   └── github-upload.ts # Add to README
    │
    ├── readme/              # /readme - README gen
    │   ├── index.ts
    │   └── generator.ts
    │
    └── next/                # /next - project carousel
        ├── index.ts
        ├── selector.ts      # Pick best projects
        ├── cards.ts         # Card generation
        └── format.ts        # Carousel UI
```

## Tool Interface

```typescript
interface Tool {
  name: string;
  version: string;
  description: string;
  
  // What triggers this tool
  commands?: ToolCommand[];         // /repo, /preview, etc.
  messageHandlers?: MessageHandler[]; // photo detection
  callbackHandlers?: CallbackHandler[]; // button presses
  
  // Lifecycle
  init?: () => Promise<void>;
}

interface ToolCommand {
  name: string;           // "repo", "preview"
  description: string;    // For /help
  handler: (ctx, args) => Promise<void>;
}
```

## `/next` Carousel UX

```
┌──────────────────────────────────────┐
│  🔥 github-tndr                      │
│                                      │
│  High momentum · 3 commits today     │
│  "Chart analysis working, plugin     │
│   refactor planned for tomorrow"     │
│                                      │
│  [← Prev]  [🎯 Work on this]  [Next →]│
└──────────────────────────────────────┘
```

- Shows preview card with context
- ← → buttons to scrub through candidates
- "Work on this" locks in your choice

## `/preview` Flow

```
You: /preview github-tndr

Bot: 🎨 Generating cover...

Bot: [shows generated image]
     "github-tndr cover"
     [✅ Use this] [🔄 Regenerate] [❌ Cancel]

You: [✅ Use this]

Bot: ✅ Added to README header
     → github.com/satoshi/github-tndr
```

## External Repo Sync (chart ↔ bel-rtr)

| github-tndr | bel-rtr | Synced? |
|-------------|---------|---------|
| `lib/tools/chart/analysis.ts` | `lib/analysis.ts` | ✅ |
| `lib/tools/chart/annotate.ts` | `lib/annotate.ts` | ✅ |
| `lib/tools/chart/types.ts` | `lib/types.ts` | ✅ |
| `lib/tools/chart/format.ts` | — | ❌ Local |

GitHub Actions auto-creates PRs when synced files change.

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Extract `lib/core/` (config, github, state, logger, types)
- [ ] Create `lib/tools/types.ts` with Tool interface
- [ ] Create `lib/tools/registry.ts` with routing

### Phase 2: Migrate Tools (one at a time)
- [ ] `chart/` — already exists, just restructure
- [ ] `repo/` — extract from current handlers
- [ ] `scan/` — extract from telegram.ts
- [ ] `preview/` — extract from nano-banana.ts
- [ ] `readme/` — extract from readme-generator.ts
- [ ] `next/` — extract from card-generator.ts, add carousel UX

### Phase 3: Slim Down Router
- [ ] Refactor `api/telegram.ts` to ~100 lines
- [ ] All logic delegates to tool registry

### Phase 4: Sync Workflows
- [ ] `.github/workflows/sync-to-bel-rtr.yml`
- [ ] Mirror workflow in bel-rtr repo

---

*Last updated: December 18, 2025*

