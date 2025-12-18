# Plugin Architecture Plan

> Status: **PLANNING** — Finalizing tool list before implementation

## Overview

Restructure the codebase into a plugin-based architecture where all tools (GitHub repo analysis, chart analysis, AI generation, watch system) are isolated modules with standard interfaces, enabling bidirectional sync with external repos (like bel-rtr) and easy addition/removal of capabilities.

## Current State

Everything lives in a flat structure with tight coupling. The 1000+ line `api/telegram.ts` imports directly from scattered modules.

```
lib/
├── analyzer.ts          # Repo analysis
├── github.ts            # GitHub API
├── chart/               # Chart analysis (from bel-rtr)
├── ai/                  # AI generation functions
├── bot/handlers/        # Telegram handlers
├── card-generator.ts    # Card/feed system
├── nano-banana.ts       # Cover image generation
├── screenshot.ts        # Website screenshots
├── readme-generator.ts  # README generation
└── ...
```

## Proposed Architecture

```
lib/
├── core/                    # Shared infrastructure
│   ├── config.ts
│   ├── logger.ts
│   ├── state.ts
│   └── types.ts
│
└── tools/                   # Each tool is isolated
    ├── types.ts             # Tool interface definition
    ├── registry.ts          # Auto-discovery & routing
    │
    ├── repo/                # GitHub repo analysis
    ├── chart/               # Chart analysis (syncs with bel-rtr)
    ├── cover/               # Cover image generation
    ├── screenshot/          # Website screenshots
    ├── readme/              # README generation
    ├── cursor-prompt/       # Cursor prompt generation
    ├── copy/                # Marketing copy generation
    ├── launch-post/         # Launch post generation
    ├── deep-dive/           # Project deep dive
    ├── watch/               # Push notification system
    ├── cards/               # Card/feed system
    └── push-feedback/       # AI feedback on pushes
```

## Proposed Tool Interface

```typescript
interface Tool {
  name: string;
  version: string;
  description: string;
  
  // Telegram integration
  commands?: ToolCommand[];        // /repo, /chart, /cover
  messageHandlers?: MessageHandler[]; // photo, document
  callbackHandlers?: CallbackHandler[]; // button callbacks
  
  // Dependencies
  requires?: string[];  // Other tool names this depends on
  
  // Lifecycle
  init?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}
```

## Complete Tool Inventory

### Analysis Tools
| Tool | Command | Description |
|------|---------|-------------|
| **repo** | `/repo <name>` | Analyze GitHub repo, give ship/cut/kill verdict |
| **chart** | Send photo | Analyze chart images, identify zones, annotate |
| **scan** | `/scan` | Batch scan all user's repos |

### Generation Tools
| Tool | Command | Description |
|------|---------|-------------|
| **cover** | `/cover <name>` | Generate Gemini 3 Pro cover image |
| **screenshot** | `/screenshot <url>` | Take screenshot of any URL |
| **readme** | `/readme <name>` | Generate/optimize README |
| **cursor-prompt** | `/cursor <name>` | Generate Cursor prompt for next step |
| **copy** | `/copy <name>` | Generate marketing copy |
| **launch-post** | `/launch <name>` | Generate launch post (X/LinkedIn) |

### Context Tools
| Tool | Command | Description |
|------|---------|-------------|
| **deep-dive** | `/dive <name>` | Restore context + 3 actionable next steps |

### Notification Tools
| Tool | Command | Description |
|------|---------|-------------|
| **watch** | `/watch`, `/unwatch`, `/watching` | Push notification subscriptions |
| **push-feedback** | GitHub webhook | AI feedback on meaningful pushes |

### Feed Tools
| Tool | Command | Description |
|------|---------|-------------|
| **cards** | `/next`, `/skip` | Swipe through repos with AI cards |

## External Repo Sync

The `chart/` tool will have bidirectional sync with the `bel-rtr` repo:

| github-tndr | bel-rtr | Synced? |
|-------------|---------|---------|
| `lib/tools/chart/analysis.ts` | `lib/analysis.ts` | ✅ Yes |
| `lib/tools/chart/annotate.ts` | `lib/annotate.ts` | ✅ Yes |
| `lib/tools/chart/types.ts` | `lib/types.ts` | ✅ Yes |
| `lib/tools/chart/handler.ts` | — | ❌ Local only |

GitHub Actions workflows will automatically create PRs when synced files change in either repo.

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Create `lib/core/` with shared infrastructure
- [ ] Create `lib/tools/types.ts` with Tool interface
- [ ] Create `lib/tools/registry.ts` with routing logic

### Phase 2: Migrate Existing Features
- [ ] Migrate `watch` (standalone, no deps)
- [ ] Migrate `chart` (standalone, external sync)
- [ ] Migrate `repo` (core feature)
- [ ] Migrate `ai` tools (cursor, copy, launch, deep-dive)
- [ ] Migrate `cards` (depends on repo)

### Phase 3: Refactor Telegram Router
- [ ] Slim down `api/telegram.ts` to ~200 lines
- [ ] Use registry for all command/callback routing

### Phase 4: Set Up Sync Workflows
- [ ] Create `.github/workflows/sync-to-bel-rtr.yml`
- [ ] Create mirror workflow in bel-rtr
- [ ] Set up `CROSS_REPO_PAT` secret

## Next Steps

**Before implementation:** Review and finalize the tool list above. Some tools may be cut, renamed, or consolidated.

---

*Last updated: December 18, 2025*

