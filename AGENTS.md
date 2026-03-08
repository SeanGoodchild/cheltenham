# Cheltenham Tracker Notes

This file captures repo-specific guidance so future changes stay aligned with the current app.

## Product Language
- In the UI, bets are called `toots`.
- Preferred user-facing copy:
  - `Have a Toot`
  - `Submit toot`
  - `Open Toots`
  - `My Toots`
- Internal code can continue to use `bet`, `bets`, and `Bet` types. Do not rename the domain model just for copy changes.

## Current App Shape
- Tabs:
  - `Have a Toot`
  - `Cashboard`
  - `My Toots`
- The selected user is controlled from the avatar switcher in the top right.
- The cashboard filter is a simple `All` / `Me` toggle.
  - `Me` always means the currently selected user.
- Odds display defaults to `fractional` and can be toggled in the sidebar.
  - Keep decimal odds for calculations and persistence.
- There is no admin panel in the UI.
- The `Next Race` card shows:
  - best / worst winner summary
  - upcoming field
  - user avatars beside backed horses
- The main P&L candle chart no longer shows outcome/error bands.

## Race Data
- Race imports now come from Sporting Life, not the old CloudFront race source.
- Source of truth for Cheltenham 2026 race pages:
  - `public/race_urls.txt`
- Server import flow:
  - fetch Sporting Life HTML
  - extract `__NEXT_DATA__`
  - parse `props.pageProps.race`
  - map into the existing `Race` model
- `Race.source` may be:
  - `sportinglife`
  - `manual`
  - legacy `cloudfront` values may still exist in stored data
- Odds import remains a separate concern from the Sporting Life page import.

## Server / Realtime
- Backend entrypoint: `server/index.ts`
- Frontend talks to the server only through REST + SSE.
- Firestore access is server-side only.
- `/api/stream` uses SSE heartbeats and a longer Bun `idleTimeout` to avoid reconnect churn.
- When touching state broadcasting, avoid introducing synthetic timestamp-only changes that force unnecessary SSE updates.

## UI Constraints
- The Place a Toot flow should use the day/time quick-pick pills for race selection.
  - Do not reintroduce the large full race dropdown.
- Horse lists should be sorted by odds, favourite first, with runners lacking odds at the bottom.
- PNG avatars in `public/avatars` are transparent assets.
  - Do not add background fills behind real avatar images.
- Gordo has hardcoded joke behavior:
  - ultra-black UI theme when selected
  - extra leading zeroes in league-table currency values

## Editing Guidance
- Prefer small, targeted updates over broad terminology rewrites.
- Keep docs in sync when changing:
  - user-facing naming
  - import sources
  - admin/runtime behavior
