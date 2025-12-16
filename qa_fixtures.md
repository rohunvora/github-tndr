# QA Test Fixtures - Executed Run

> **STATUS: EXECUTED — Real test data from all testable scenarios**

---

## Scenario 1: Missing Env Var ✅ EXECUTED

### Setup Performed
| Field | Value |
|-------|-------|
| **Condition created** | Added `.env.example` with `DEMO_API_KEY=your_api_key_here` |
| **Commit SHA** | `bca7689c68c958b13a1b19087eabd7fc1a84170f` |
| **Deployment ID** | `dpl_CRzW9x7b5cU3tZ5MjChtvkBEuSAp` |
| **Deploy Status** | `ERROR` (due to config, not the env var itself) |
| **Env var name** | `DEMO_API_KEY` |

### Actual Output
| Field | Actual Value |
|-------|--------------|
| `gtm_stage` | `building` ✅ |
| `action_type` | `build` ✅ |
| `next_action` | "Fix deploy error: unknown issue" ⚠️ (should be "Add missing env var") |
| `artifact_type` | `cursor_prompt` ⚠️ (should be `env_checklist`) |
| `should_auto_message` | `true` ✅ |

### Bot Message
```
**anti-slop-lib** 🔨 Building

Missing 1 critical env var: DEMO_API_KEY
Missing: `DEMO_API_KEY`

Want a Cursor prompt to fix this?
```

### Cleanup
- Deleted `.env.example` file after test

---

## Scenario 2: Build Error ✅ EXECUTED

### Setup Performed
| Field | Value |
|-------|-------|
| **Condition created** | Added bad import to `demo-website/app/page.tsx` |
| **Bad import** | `import { nonExistentFunction } from './this-file-does-not-exist';` |
| **Commit SHA** | `b577da5d3f272fe88348118cba30f90f540854f6` |
| **Deployment ID** | `dpl_6XrMos33KS8WzQiRJCyRSNQyqNFm` |
| **Error Code** | `lint_or_type_error` |
| **Error Message** | `Command "npm run build" exited with 1` |

### Vercel Build Log (Actual Error)
```
Error: Cannot find module './this-file-does-not-exist'
  at demo-website/app/page.tsx:1:1

Caused by:
    Syntax Error

Import trace for requested module:
./app/page.tsx

> Build failed because of webpack errors
```

### Actual Output
| Field | Actual Value |
|-------|--------------|
| `gtm_stage` | `building` ✅ |
| `action_type` | `build` ✅ |
| `next_action` | "Fix deploy error: unknown issue" ⚠️ |
| `artifact_type` | `cursor_prompt` ✅ |
| `should_auto_message` | `true` ✅ |

### Bot Message
```
**anti-slop-lib** 🔨 Building

Want a Cursor prompt to fix this?
```

### Finding
**Critical gap**: Bot does NOT show the actual error log. User has no idea what's broken.

### Cleanup
- Restored original `page.tsx` from commit `b00189c3caebda118387117cad851c78ffedf4f3`

---

## Scenario 3: Missing CTA ✅ EXECUTED

### Setup Performed
| Field | Value |
|-------|-------|
| **Condition created** | Edited README.md to remove all CTAs |
| **Removed patterns** | "Try it", "Get started", "Install", "Quick Start", "Demo" |
| **Commit SHA** | (created during test) |
| **Deployment ID** | `dpl_2zgcqf9SMcwSNhXxuJGgSchjJKgC` |
| **Deploy URL** | `https://demo-website-c2rembbnl-rohun-voras-projects.vercel.app` |
| **Deploy Status** | `READY` (green) |

### README Content (No CTA Version)
```markdown
# 🚫 Anti-Slop

**Detect and prevent AI-generated "slop" aesthetic in web projects.**

## What is "Slop"?
... (description only, no installation/usage instructions)

## About
This project analyzes CSS and HTML for common AI-generated design patterns.

## Features
- Pattern detection
- Scoring system
- Suggestions

## License
MIT
```

### Actual Output
| Field | Actual Value |
|-------|--------------|
| `gtm_stage` | `ready_to_launch` ❌ (should be `packaging`) |
| `action_type` | `gtm` ✅ |
| `next_action` | "Add clear CTA to README/landing" ✅ |
| `artifact_type` | `landing_copy` ✅ |
| `should_auto_message` | `true` |

### Bot Message
```
**anti-slop-lib** 🚀 Ready to Launch

No clear CTA in README

🔗 https://demo-website-c2rembbnl-rohun-voras-projects.vercel.app

What's next?
```

### Finding
**Bug**: Bot says "Ready to Launch" but identifies missing CTA. Stage should be "Packaging".

### Cleanup
- Restored original README.md

---

## Scenario 4: Mobile Broken ⚠️ NOT TESTABLE

### Why Not Tested
Bot code shows:
```typescript
// collector.ts line 520
const mobileUsable = urlLoads;  // Assumes mobile = desktop
```

The bot does not:
- Capture mobile viewport screenshots
- Analyze mobile layout
- Detect mobile-specific issues

### Recommendation
Implement mobile testing via Microlink's `viewport` parameter:
```
https://api.microlink.io/?url=...&screenshot=true&viewport.width=375&viewport.height=812
```

---

## Scenario 5: Ready to Launch ✅ EXECUTED

### Setup (Already in this state from earlier)
| Field | Value |
|-------|-------|
| **Deploy Status** | `READY` |
| **Deploy URL** | `https://demo-website-m7shvm36j-rohun-voras-projects.vercel.app` |
| **Screenshot URL** | `https://iad.microlink.io/gOFAGltEKRb1tfMHOX5gZq-aHJIcKmE2TLz0FEUtjsrFyG0itoUHzRDjOumGTf-ASfxoOOVmobSZHnnGPvwiJA.png` |

### GTM Checks (All Passed)
```json
{
  "deployGreen": true,
  "urlLoads": true,
  "hasClearCTA": true,
  "mobileUsable": true,
  "hasLandingContent": true,
  "hasReadme": true,
  "hasDescription": true,
  "hasDemoAsset": true
}
```

### Actual Output
| Field | Actual Value |
|-------|--------------|
| `gtm_stage` | `ready_to_launch` ✅ |
| `action_type` | `gtm` ✅ |
| `next_action` | "Draft and post launch announcement" ✅ |
| `artifact_type` | `launch_post` ✅ |
| `should_auto_message` | `true` ✅ |

### Bot Message
```
**anti-slop-lib** 🚀 Ready to Launch

🔗 https://demo-website-m7shvm36j-rohun-voras-projects.vercel.app

Ready to post? I can draft the announcement.
```

### Launch Post Generated
```
just shipped anti-slop-lib 🔥

a cli tool packed with quality UI references to stop AI from generating generic "vibecode slop" designs

tired of every AI mockup looking the same? this actually helps you build something that doesn't scream "made with AI"

try it: https://demo-website-m7shvm36j-rohun-voras-projects.vercel.app
```

---

## Scenario 6: Post-Launch Loop ✅ EXECUTED

### Setup Performed
| Field | Value |
|-------|-------|
| **User message** | `"got 50 likes, people are asking for dark mode"` |
| **Sent via** | Telegram webhook simulation |
| **Timestamp** | `2025-12-16T00:22:08.478Z` |

### Expected Output
- Acknowledge traction (50 likes)
- Suggest follow-up post
- Provide ONE action: "Add dark mode" with Cursor prompt
- NOT a list of 12 things

### Actual Output
| Field | Actual Value |
|-------|--------------|
| `gtm_stage` | `ready_to_launch` ❌ (should be `post_launch`) |
| `action_type` | `gtm` |
| `next_action` | "Add clear CTA to README/landing" ❌ (should be dark mode related) |
| `artifact_type` | `landing_copy` ❌ (should be `cursor_prompt` for dark mode) |

### Bot Message
```
**Landing Copy:**

# Headline
**Stop AI From Ruining Your UI**

## Subheadline
A curated reference library that trains AI to generate clean, purposeful interfaces...

## Key Benefits
... (generic landing copy)

## Call-to-Action
**Install Anti-Slop Now**
```

### Finding
**Critical gap**: Bot completely ignores user feedback. Does not:
- Acknowledge the 50 likes
- Recognize "dark mode" as a feature request
- Suggest a follow-up post
- Provide actionable next step based on feedback

---

## Redaction Confirmation

All data in this file:
- ❌ Contains no API keys, tokens, or secrets
- ❌ Contains no env var VALUES (only names)
- ✅ Deployment IDs are real
- ✅ Commit SHAs are real
- ✅ URLs are real and public
- ✅ Error messages are real (no embedded secrets)
