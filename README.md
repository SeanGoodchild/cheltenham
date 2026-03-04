# Cheltenham Bet Tracker (Phase 1)

Phase 1 implementation of the Cheltenham tracker with:
- Bet entry (single / each-way / accumulator)
- Main cashboard + league table
- Personal stats + bet slip
- Manual race result entry + settlement
- Realtime updates via server-sent events (SSE)

## Architecture (Server-side Firestore)
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
- `POST /api/seed-races`
- `POST /api/stats/recompute`
- `POST /api/bets`
- `PUT /api/bets/:id`
- `DELETE /api/bets/:id`
- `POST /api/races`
- `POST /api/races/:id/result`
- `POST /api/races/:id/settle`
- `POST /api/notifications/daily-summary`

## Notes
- Access/auth is still intentionally lightweight for your private group.
- Automation workers (scheduled polling/scraper/API) remain Phase 2.
