# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # install dependencies
bun run dev:full         # start server + client together
bun run dev:server       # Bun API server only (port 3001)
bun run dev:client       # Vite frontend only (port 5173)
bun run build            # tsc -b && vite build
bun run lint             # eslint
bun run test             # vitest run (settlement + sportingLife parser tests)
bun run check:esm        # check ESM import correctness
```

## Architecture

Cheltenham betting tracker for a private group. Bets are called **toots** in the UI but `Bet`/`bet` in code.

**Frontend:** Vite + React 19 + TypeScript + shadcn/ui + TailwindCSS. Path alias `@/*` → `./src/*`.

**Backend:** Single Bun HTTP server (`server/index.ts`, ~2600 lines). All Firestore access is server-side only — the frontend never touches Firestore directly.

**Realtime:** Frontend subscribes via SSE (`/api/stream`). The `src/lib/firebase.ts` module manages SSE subscriptions with automatic reconnection and heartbeat keepalives. No WebSocket.

**Deployment:** Vercel serverless functions. `api/[...path].ts` + `api/handler.ts` catch-all routes forward to the same handler logic. 5-minute function timeout.

**Auth:** Intentionally lightweight — user selection via avatar switcher, no formal auth (private group).

## Key Files

- `server/index.ts` — all backend logic: Firestore CRUD, race imports, settlement, stats, SSE broadcasting, Telegram notifications
- `src/App.tsx` — app shell with tabs, user selection, state management
- `src/hooks/useTrackerData.ts` — main data subscription hook (bootstraps season, subscribes to all streams)
- `src/lib/firebase.ts` — REST + SSE API client with listener-based state cache
- `src/lib/types.ts` — domain types: `Bet`, `Race`, `UserProfile`, `UserStats`, `GlobalStats`
- `src/lib/settlement.ts` — betting math (odds, returns, P&L, leg results) — has unit tests
- `src/lib/sportingLife.ts` — HTML parser for Sporting Life race pages — has unit tests
- `src/lib/constants.ts` — hardcoded user profiles, sample races, Firestore root (`cl/2026`)
- `src/components/tracker/` — domain UI: BetPanel, MainBoard, PersonalPanel, PnlCandlesPanel, StatsCards

## Firestore Shape

All data lives under `cl/2026/`: `users/`, `races/`, `bets/`, `stats_users/`, `stats_global/overview`, `events/`, `notifications/`, `jobs/`

## Race Import Pipeline

1. URLs in `public/race_urls.txt` → fetch Sporting Life HTML → extract `__NEXT_DATA__` JSON → parse `props.pageProps.race` → map to `Race` model
2. Odds imported separately from Irish Racing as a merge step
3. Non-runner detection auto-voids affected bet legs
4. Import lock mechanism prevents overwrites within 10 minutes

## Product & UI Rules (from AGENTS.md)

- UI says "toots", code says "bets" — don't rename the domain model
- Race selection uses day/time quick-pick pills, not a full dropdown
- Horse lists sorted by odds (favourite first), runners without odds at bottom
- Odds default to fractional display, decimal used for calculations/persistence
- PNG avatars in `public/avatars/` are transparent — no background fills
- Gordo has hardcoded joke behavior: ultra-black theme + leading zeroes in currency
- Avoid synthetic timestamp-only SSE updates
- Prefer small targeted updates over broad rewrites
