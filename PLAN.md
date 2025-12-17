# UX Improvement Plan: Show the Work + Fix Annoyances

## Problem Summary

The bot does valuable work but hides it from users. Combined with several UX friction points, this creates an experience where users feel uncertain, trapped, and unable to course-correct.

**Core insight from "Agentic Interfaces" article:**
> "Part of what's fun about using an agent is the dopamine hit... People want to see work in motion."

---

## Scope

**In scope (Phase 1-2 only):**
- Show the work (streaming progress)
- Fix dead ends (session recovery, broken links)
- Consolidate noisy notifications

**Deferred (revisit after 2 weeks of usage):**
- Power-user features (I disagree, undo skip, /refresh, /focus)
- Artifact generation streaming (low frequency action)
- Polish features (confidence indicators, "why this?")

---

## Phase 1: Show the Work (High Impact, Medium Effort)

### 1.1 Streaming Progress for Card Generation

**Problem:** `generateCard()` takes 5-15 seconds with only "typing..." indicator.

**Solution:** Show incremental progress messages as each step completes.

**Current flow:**
```
User: /next
Bot: [typing... 10 seconds of nothing]
Bot: [Full card appears]
```

**New flow:**
```
User: /next
Bot: 🔍 Loading github-tndr...
Bot: [edit] 📊 Stage: building | Last push: 2 days ago
Bot: [edit] 💡 Analyzing potential...
Bot: [edit] 🎯 Potential: "Ship or kill your side projects"
Bot: [edit] 📝 Determining next step...
Bot: [edit → final card with buttons]
```

**Error state (REQUIRED):**
```
User: /next
Bot: 🔍 Loading github-tndr...
Bot: [edit] 💡 Analyzing potential...
Bot: [edit] ❌ Failed to generate card
       Error: API timeout

       [Retry] [Skip to Next]
```

**Implementation:**
- File: `api/telegram.ts` → `/next` command handler
- File: `lib/card-generator.ts` → `generateCard()`
- Add `onProgress` callback parameter to `generateCard()`
- Edit message in place as each step completes
- Final edit adds the action buttons
- Wrap in try/catch, show error state with retry button on failure

**Files to change:**
| File | Change |
|------|--------|
| `lib/card-generator.ts` | Add `onProgress?: (step: string) => Promise<void>` parameter |
| `api/telegram.ts` | Pass progress callback that edits message |
| `lib/bot/format.ts` | Add `formatCardProgress(step, partialData)` and `formatCardError(error)` |

---

### 1.2 Streaming Progress for Scan (Rate-Limit Safe)

**Problem:** Scan shows progress bar but not what's happening. Partial completion is silent.

**Current:**
```
⏳ Scanning...
🟩🟩🟩🟩⬜⬜⬜⬜⬜⬜ 12/30
```

**New (rate-limit safe - edit every 2-3 repos, not every repo):**
```
⏳ 12/30 repos analyzed
Currently: side-project-3

Verdicts so far:
🟢 3 ship | 🟡 5 cut | 🔴 2 no core | ☠️ 2 dead

[Cancel]
```

**Timeout state (explicit):**
```
⏸ Stopped at 55s limit

Analyzed: 15/30 repos
Skipped: 15 repos (run /scan again to continue)

🟢 3 ship | 🟡 5 cut | 🔴 4 no core | ☠️ 3 dead
```

**Implementation:**
- Update message every 2-3 repos (not every repo) to avoid Telegram rate limits
- Show aggregate verdict counts, not per-repo list
- Make timeout explicit with count of skipped repos

**Files to change:**
| File | Change |
|------|--------|
| `api/telegram.ts` | Refactor `runScan()` progress updates |
| `lib/bot/format.ts` | Add `formatScanProgressV2(analyzed, total, current, verdictCounts)` |

---

## Phase 2: Fix Dead Ends (High Impact, Low Effort)

### 2.1 Fix Hardcoded Vercel URL (Simple)

**Problem:** Every card shows `[live](https://{name}.vercel.app)` even if not deployed there.

**Solution:** Use GitHub `homepage` field if present, otherwise hide link entirely. No HTTP checks.

```typescript
// Current:
const vercelUrl = `https://${card.repo}.vercel.app`;
lines.push(`**${card.repo}** ${stageLabel(card.stage)} • [live](${vercelUrl})`);

// New:
if (card.deploy_url) {
  lines.push(`**${card.repo}** ${stageLabel(card.stage)} • [live](${card.deploy_url})`);
} else {
  lines.push(`**${card.repo}** ${stageLabel(card.stage)}`);
}
```

**Implementation:**
- GitHub API already returns `homepage` field
- Store it in TrackedRepo during analysis
- Use it in card formatting, or hide link if null
- **DO NOT** add HTTP checks (adds latency, complexity)

**Files to change:**
| File | Change |
|------|--------|
| `lib/core-types.ts` | Add `homepage?: string` to TrackedRepo |
| `lib/analyzer.ts` | Capture `homepage` from GitHub API during analysis |
| `lib/bot/format.ts` | Show link only if `homepage` exists |
| `lib/card-generator.ts` | Pass `homepage` through to RepoCard |

---

### 2.2 Graceful Session Expiration

**Problem:** Old buttons return "Session expired. /next" with no context.

**Current:** Toast message, user has to start over.

**New:** Re-fetch the repo and show current state with fresh buttons.

```typescript
// Instead of:
if (!session) {
  await ctx.answerCallbackQuery({ text: 'Session expired. /next' });
  return;
}

// Do:
if (!session) {
  // Try to recover context from callback data
  const [owner, name] = parseRepoFromCallback(parts);
  const repo = await stateManager.getTrackedRepo(owner, name);
  if (repo) {
    // Show fresh card with new session
    const card = await generateCard(...);
    const newSession = await createCardSession(card);
    await ctx.editMessageText(formatRepoCard(card), { reply_markup: cardKeyboard(newSession) });
    await ctx.answerCallbackQuery({ text: 'Session refreshed' });
  } else {
    await ctx.answerCallbackQuery({ text: 'Repo not found. Try /next' });
  }
}
```

**Files to change:**
| File | Change |
|------|--------|
| `api/telegram.ts` | `handleSessionAction` - add recovery logic |
| `lib/card-session.ts` | Store `full_name` in session for recovery |

---

### 2.3 Consolidate Morning Stack Messages

**Problem:** Morning stack sends 3-5 separate messages at 9am. Feels spammy.

**Solution:** Send one consolidated message with top 3 cards inline.

**Current:**
```
Message 1: ☀️ Good morning! Here's your stack...
Message 2: [Photo + Card 1 details]
Message 3: Card 2 compact
Message 4: Card 3 compact
Message 5: Tap "Start First Card"...
```

**New:**
```
☀️ Good morning! Here's your stack:

1. **github-tndr** — 🚀 Ready
   _Next: Write launch post_

2. **side-project** — 🔨 Building
   _Next: Fix auth flow_

3. **another-one** — 📦 Packaging
   _Next: Add demo GIF_

[Start #1] [Skip Today]
```

**Files to change:**
| File | Change |
|------|--------|
| `api/cron/morning-stack.ts` | Consolidate into single message |
| `lib/bot/format.ts` | Add `formatMorningStack(cards[])` |
| `lib/bot/keyboards.ts` | Add `morningStackKeyboardV2()` |

---

### 2.4 Button Mashing Protection (Idempotency)

**Problem:** Users tap buttons multiple times. "Do it" triggers AI generation — what if they tap 3x?

**Solution:** Add action-level idempotency. Track "in-flight" actions per session.

```typescript
// In handleSessionAction:
const actionKey = `action:${sessionId}:${action}`;
const inFlight = await kv.get(actionKey);
if (inFlight) {
  await ctx.answerCallbackQuery({ text: 'Already processing...' });
  return;
}
await kv.set(actionKey, true, { ex: 60 }); // 60s TTL

try {
  // ... do the work
} finally {
  await kv.del(actionKey);
}
```

**Files to change:**
| File | Change |
|------|--------|
| `api/telegram.ts` | Add idempotency check in `handleSessionAction` |

---

## Implementation Order (Revised)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Fix hardcoded Vercel URL | 30m | High |
| 2 | Streaming progress for /next | 2h | High |
| 3 | Graceful session expiration | 1.5h | High |
| 4 | Button mashing protection | 30m | Medium |
| 5 | Streaming progress for scan | 1.5h | Medium |
| 6 | Consolidate morning stack | 1h | Medium |

**Total: ~7 hours**

**Order rationale:**
1. Quick win, removes broken links immediately
2. Biggest UX impact, establishes streaming pattern
3. Fixes frustrating dead ends
4. Prevents duplicate work from eager users
5. Applies streaming pattern to scan
6. Reduces notification noise

---

## Testing Checklist

Before shipping each change, verify:

**For streaming progress (1.1, 1.2):**
- [ ] Happy path: progress shows, final card appears
- [ ] Timeout: explicit message about what was skipped
- [ ] API error: error state with retry button
- [ ] User cancels mid-stream: clean stop

**For session recovery (2.2):**
- [ ] Expired session recovers correctly
- [ ] Recovery shows fresh data, not stale
- [ ] Non-existent repo shows helpful error

**For morning stack (2.3):**
- [ ] Single message, not multiple
- [ ] Buttons work correctly
- [ ] Empty state handled (no repos)

**For idempotency (2.4):**
- [ ] Double-tap doesn't trigger duplicate work
- [ ] Lock releases after completion
- [ ] Lock releases on error

---

## Success Metrics

After implementation:

1. **No mystery waits** — User always knows what's happening during AI calls
2. **No dead ends** — Expired sessions recover gracefully
3. **No broken links** — Live URLs only shown when actually live
4. **Calm mornings** — One consolidated notification, not 5
5. **No duplicate work** — Button mashing is handled

---

## Deferred (Revisit in 2 weeks)

These are explicitly out of scope for now:

**Power-user features:**
- "I Disagree" verdict override
- "Undo Skip" / `/focus <repo>`
- `/refresh <repo>` cache invalidation

**Lower-priority streaming:**
- Artifact generation progress (low frequency action)

**Polish:**
- Confidence indicators on next steps
- "Why this?" explainer button

**Infrastructure:**
- Auto-watch on analyze
- Polling instead of webhooks
- Alternative interfaces (VS Code, CLI)

Revisit after using the improved bot for 2 weeks to validate the core loop works.
