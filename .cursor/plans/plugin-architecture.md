# Plugin Architecture Plan

> Status: **PHASE 1-2 COMPLETE** — Tools migrated, ready for router refactor

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

## Architecture (IMPLEMENTED)

```
lib/
├── core/                    # ✅ Shared infrastructure
│   ├── config.ts            # AI providers, env vars
│   ├── github.ts            # GitHub API client
│   ├── state.ts             # Vercel KV state
│   ├── logger.ts            # Logging
│   ├── types.ts             # Shared types
│   └── index.ts             # Re-exports
│
└── tools/                   # ✅ Each tool is isolated
    ├── types.ts             # Tool interface
    ├── registry.ts          # Auto-wires tools to bot
    ├── index.ts             # Exports all tools
    │
    ├── repo/                # ✅ /repo - GitHub analysis
    │   ├── index.ts         # Tool definition
    │   ├── analyzer.ts      # Analysis logic
    │   ├── prompts.ts       # AI prompts
    │   ├── handler.ts       # Command handler
    │   └── format.ts        # Telegram formatting
    │
    ├── chart/               # ✅ Photo → chart analysis
    │   ├── index.ts         # Tool definition
    │   ├── analysis.ts      # Core logic (SYNCS with bel-rtr)
    │   ├── types.ts         # Types (SYNCS)
    │   ├── handler.ts       # Photo handler
    │   └── format.ts        # Telegram formatting (local)
    │
    ├── scan/                # ✅ /scan - batch analysis
    │   ├── index.ts
    │   ├── handler.ts
    │   └── format.ts
    │
    ├── preview/             # ✅ /preview - cover image
    │   ├── index.ts
    │   ├── generator.ts     # Gemini image gen
    │   └── handler.ts       # Approval flow
    │
    ├── readme/              # ✅ /readme - README gen
    │   ├── index.ts
    │   ├── generator.ts
    │   └── handler.ts
    │
    └── next/                # ✅ /next - project carousel
        ├── index.ts
        ├── selector.ts      # Pick best projects
        ├── handler.ts       # Carousel navigation
        └── format.ts        # Card UI
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
│  🔥 github-tndr         (1/5)        │
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
     [✅ Add to README] [🔄 Regenerate] [❌ Cancel]

You: [✅ Add to README]

Bot: ✅ Cover added!
     → .github/social-preview.png
```

## External Repo Sync (chart ↔ bel-rtr)

| github-tndr | bel-rtr | Synced? |
|-------------|---------|---------|
| `lib/tools/chart/analysis.ts` | `lib/analysis.ts` | 🔄 To sync |
| `lib/tools/chart/types.ts` | `lib/types.ts` | 🔄 To sync |
| `lib/tools/chart/format.ts` | — | ❌ Local only |

GitHub Actions auto-creates PRs when synced files change.

## Implementation Phases

### Phase 1: Core Infrastructure ✅
- [x] Extract `lib/core/` (config, github, state, logger, types)
- [x] Create `lib/tools/types.ts` with Tool interface
- [x] Create `lib/tools/registry.ts` with routing

### Phase 2: Migrate Tools ✅
- [x] `chart/` — restructured with handler/format split
- [x] `repo/` — extracted from current handlers
- [x] `scan/` — extracted from telegram.ts
- [x] `preview/` — extracted from nano-banana.ts
- [x] `readme/` — extracted from readme-generator.ts
- [x] `next/` — new carousel UX implementation

### Phase 3: Slim Down Router 🔄 (Next)
- [ ] Refactor `api/telegram.ts` to use registry
- [ ] Move all command handlers to tools
- [ ] All logic delegates to tool registry

### Phase 4: Sync Workflows 📋 (Planned)
- [ ] `.github/workflows/sync-to-bel-rtr.yml`
- [ ] Mirror workflow in bel-rtr repo

---

*Last updated: December 18, 2025*
