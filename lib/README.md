# /lib Directory Structure

This document explains the organization of the lib/ directory to prevent confusion during development.

## Active Modules (IN USE)

### `/core/` - Shared Infrastructure
- `config.ts` - AI client configuration (Anthropic, Gemini)
- `github.ts` - GitHub API client
- `state.ts` - Vercel KV state management
- `types.ts` - Shared type definitions
- `logger.ts` - Logging utilities

### `/chart/` - Trading Chart Analysis
**Purpose**: Analyze trading chart screenshots and annotate with TA zones
**Trigger**: User sends a photo to the Telegram bot
**Flow**: Photo → Gemini Vision → Extract S/R levels → Gemini Image → Annotated chart

### `/tools/preview/` - GitHub Repo Cover Image Generator
**Purpose**: Generate product mockup/cover images for GitHub repos
**Trigger**: `/preview` command or callback button
**Flow**: GitHub repo → Analyze content → Gemini Image → Product mockup

### `/tools/readme/` - README Generator
**Purpose**: Generate optimized READMEs for GitHub repos
**Trigger**: `/readme` command

### `/tools/repo/` - Repository Analyzer
**Purpose**: Deep analysis of GitHub repos (verdict, core value, etc.)
**Trigger**: `/repo` command

### `/tools/scan/` - Batch Repository Scanner
**Purpose**: Scan recent repos and categorize by verdict
**Trigger**: `/scan` command

### `/tools/next/` - Next Action Card Generator
**Purpose**: Generate "what to work on next" cards
**Trigger**: `/next` command

### `/bot/` - Telegram Bot Utilities
- `format.ts` - Message formatting functions
- `keyboards.ts` - Inline keyboard builders
- `handlers/` - Command handlers

### `/ai/` - AI Generation Functions
- `cursor-prompt.ts` - Generate Cursor prompts
- `generate-copy.ts` - Generate marketing copy
- `generate-launch-post.ts` - Generate launch posts
- `deep-dive.ts` - Generate deep dive analysis

### `/links/` - Link Detection & Handling
- Detects GitHub URLs in messages
- Provides quick actions (TLDR, Cover, README)

### `/actions/` - Action Pipeline System
- Chains actions with auto-dependency resolution
- e.g., "preview" depends on "analyze"

## Skills System (WIP)

### `/skills/_shared/` - Skill Infrastructure
New architecture for testable, modular commands.
- `types.ts` - Skill interface definitions
- `context.ts` - Dependency injection
- `telegram-adapter.ts` - Telegram abstraction
- `sessions.ts` - Unified session management
- `progress.ts` - Progress tracking

### `/skills/chart/` - Chart Analysis Skill ✅ MIGRATED
**Wraps**: `/chart/` (does NOT duplicate logic)
**Test**: `npx tsx scripts/test-chart.ts path/to/chart.png [--save]`

### `/skills/preview/` - Cover Image Skill ✅ MIGRATED
**Wraps**: `/tools/preview/` (does NOT duplicate logic)
**Test**: `npx tsx scripts/test-preview.ts owner/repo [--save] [--upload]`

### `/skills/repo/` - Repo Analysis Skill ✅ MIGRATED
**Wraps**: `/tools/repo/` (does NOT duplicate logic)
**Test**: `npx tsx scripts/test-repo.ts owner/repo [--refresh] [--details]`

### `/skills/scan/` - Batch Scan Skill ✅ MIGRATED
**Wraps**: `/tools/scan/` (does NOT duplicate logic)
**Test**: `npx tsx scripts/test-scan.ts [days] [--dry-run] [--limit=N]`

### `/skills/next/` - Next Project Selector Skill ✅ MIGRATED
**Wraps**: `/tools/next/` (does NOT duplicate logic)
**Test**: `npx tsx scripts/test-next.ts [--limit=N] [--high] [--card]`

### `/skills/readme/` - README Generator Skill ✅ MIGRATED
**Wraps**: `/tools/readme/` (does NOT duplicate logic)
**Test**: `npx tsx scripts/test-readme.ts owner/repo [--save]`

**Note**: Skills are a work-in-progress. When migrating a command:
1. Create wrapper in `/skills/<name>/` that IMPORTS from the existing module
2. Do NOT duplicate logic
3. Add tests in `/scripts/test-<name>.ts`

## Key Rules

1. **Check imports before creating new modules** - Search for existing code first
2. **One source of truth** - Never duplicate logic across directories
3. **Mark deprecated code** - Add ⚠️ DEPRECATED comment at top of file
4. **Update this README** - When adding/removing modules
