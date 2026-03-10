# Cheltenham Tracker

Cheltenham tracker for a private group with:
- `Have a Toot` bet entry flow
- Main cashboard + league table
- `My Toots` personal history
- Upcoming race field view with backer avatars
- Manual race result entry + settlement
- Live-ish Sporting Life race imports
- Realtime updates via server-sent events (SSE)

## Architecture
- Frontend: Vite + React + TypeScript + shadcn UI
- Backend: Bun server (`server/index.ts`)
- Firestore access: **server-side only** (frontend calls API/SSE only)

The frontend no longer reads/writes Firestore directly.

## Stack
- Bun
- Vite `7.3.1`
- React + TypeScript
- Recharts
- Firebase Firestore (`cl/2026/...`)

## Product Notes
- Bets are referred to in the UI as `toots`.
- Odds display defaults to `fractional`, with a sidebar toggle for decimal display.
- The active user is controlled by the avatar switcher in the app shell.
- The cashboard filter is `All` / `Me`, where `Me` means the currently selected user.
- Simulated mode stops before the Gold Cup.

## Environment
A `.env.local` has been created with your provided `rocketmill-octane` config.

Template file: `.env.example`

For server-side Firestore access, the Bun API uses Firebase Admin credentials.
Provide one of:
- `FIREBASE_SERVICE_ACCOUNT_JSON` (raw JSON string), or
- Application Default Credentials (for example via `GOOGLE_APPLICATION_CREDENTIALS`).

## Run
Install dependencies:
```bash
bun install
```

Run backend API:
```bash
bun run dev:server
```

Run frontend:
```bash
bun run dev:client
```

Optional single command (starts both):
```bash
bun run dev:full
```

## Scripts
- `bun run dev:server` - Bun API server
- `bun run dev:client` - Vite frontend
- `bun run dev:full` - both server + client
- `bun run lint` - ESLint
- `bun run test` - settlement tests
- `bun run build` - frontend type-check + production build

## Race Data
- Cheltenham 2026 race import URLs live in [`public/race_urls.txt`](./public/race_urls.txt).
- The server fetches Sporting Life race pages, extracts the `__NEXT_DATA__` JSON blob, and maps `props.pageProps.race` into the app's `Race` model.
- This import path is used for runner data, result detection, and odds extraction from the `rides[].bookmakerOdds` / `rides[].betting` fields.

## Implemented Firestore Shape
- `cl/2026` (season metadata)
- `cl/2026/users/{userId}`
- `cl/2026/races/{raceId}`
- `cl/2026/bets/{betId}`
- `cl/2026/stats_users/{userId}`
- `cl/2026/stats_global/overview`
- `cl/2026/events/{eventId}`
- `cl/2026/notifications/{notificationId}`
- `cl/2026/jobs/{jobId}`

## API Endpoints (Phase 1)
- `GET /api/health`
- `GET /api/state`
- `GET /api/stream` (SSE)
- `POST /api/bootstrap`
- `POST /api/stats/recompute`
- `GET /api/import/races/last-run`
- `POST /api/import/races/refresh`
- `POST /api/simulate/races`
- `GET /api/simulate/info`
- `POST /api/bets`
- `PUT /api/bets/:id`
- `DELETE /api/bets/:id`
- `POST /api/bets/:id/manual-settle`
- `POST /api/races`
- `POST /api/races/:id/result`
- `POST /api/races/:id/settle`
- `POST /api/races/:id/import-lock`
- `POST /api/notifications/daily-summary`
- `POST /api/notifications/test-race-message`
- `POST /api/telegram/test-reply`
- `POST /api/telegram/webhook`

## Notes
- Access/auth is still intentionally lightweight for your private group.
- This is a serverless-style app: race refreshes are initiated while users have the app open, rather than from an always-on worker.
- SSE uses keepalive heartbeats to reduce idle reconnect churn.
- Bets manually edited from `My Toots` are treated as user overrides and are no longer auto-updated by settlement or non-runner automation.

## Deploying On Vercel (Single Host)
- This repo includes a Vercel catch-all Function route at [`api/[...path].ts`](api/[...path].ts), so `/api/*` is handled on the same host.
- For a frontend domain like `https://cash-lads.vercel.app`, leave `VITE_API_BASE_URL` unset (or set it to `""`) so the client uses same-origin `/api`.
- Exact Vercel env vars required:
  - `APP_ORIGIN=https://cash-lads.vercel.app`
  - `FIREBASE_PROJECT_ID=rocketmill-octane`
  - `FIREBASE_SERVICE_ACCOUNT_JSON=<single-line service account JSON>`
- Telegram/Gemini webhook env vars:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID` (still used for outbound race notifications)
  - `GEMINI_API_KEY`
  - `TELEGRAM_WEBHOOK_SECRET`
- If `VITE_API_BASE_URL` is currently set to `http://localhost:3001` in Vercel, remove it.
- Note: `/api/stream` (SSE) works via function streaming, but platform duration limits can still force reconnects in some environments.
- `/api/telegram/test-reply` runs the same fact-constrained Gemini reply flow used by the bot, but returns the generated reply, retry/validation details, and the fact packet without sending anything to Telegram.
- `/api/telegram/webhook` accepts Telegram updates and replies with a one-off Gemini response in direct messages, when explicitly mentioned in a group chat, or when a user replies to a bot message, using the fact-constrained tracker packet as context.
