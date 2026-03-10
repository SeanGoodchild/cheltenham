import type { Bet, GlobalStats, Race, RaceImportRun, UserProfile, UserStats } from "@/lib/types"

export type BetDraftInput = {
  userId: string
  betType: Bet["betType"]
  betName?: string
  legs: Array<{
    raceId: string
    selectionName: string
    decimalOdds?: number | null
    horseUid?: number
  }>
  oddsUsed?: number | null
  stakeTotal: number
  isFreeBet?: boolean
  ewTerms?: {
    placesPaid: number
    placeFraction: number
  }
}

export type ManualBetEditInput = BetDraftInput & {
  status: Bet["status"]
  totalReturn?: number | null
}

export type RaceImportRefreshResponse = {
  ok: true
  run: RaceImportRun
}

type TrackerState = {
  users: UserProfile[]
  races: Race[]
  bets: Bet[]
  userStats: UserStats[]
  globalStats: GlobalStats | null
  version: string
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "")
}

function resolveApiBaseUrl(): string {
  const configured = String(import.meta.env.VITE_API_BASE_URL ?? "").trim()
  if (configured) {
    return trimTrailingSlashes(configured)
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:3001"
    }
    // In production, default to same-origin /api routes.
    return ""
  }

  return ""
}

const API_BASE_URL = resolveApiBaseUrl()
function apiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

const stateCache: TrackerState = {
  users: [],
  races: [],
  bets: [],
  userStats: [],
  globalStats: null,
  version: "",
}

const usersListeners = new Set<(users: UserProfile[]) => void>()
const racesListeners = new Set<(races: Race[]) => void>()
const betsListeners = new Set<(bets: Bet[]) => void>()
const userStatsListeners = new Set<(stats: UserStats[]) => void>()
const globalStatsListeners = new Set<(stats: GlobalStats | null) => void>()

let stream: EventSource | null = null
let streamInitPromise: Promise<void> | null = null
let streamGeneration = 0

function closeRealtimeTransport() {
  streamGeneration++
  stream?.close()
  stream = null
  streamInitPromise = null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  const targetUrl = apiUrl(path)
  const method = String(init?.method ?? "GET").toUpperCase()
  const headers = new Headers(init?.headers ?? undefined)
  const shouldSetJsonHeader =
    !headers.has("Content-Type") &&
    method !== "GET" &&
    method !== "HEAD" &&
    init?.body !== undefined &&
    init?.body !== null
  if (shouldSetJsonHeader) {
    headers.set("Content-Type", "application/json")
  }
  try {
    response = await fetch(targetUrl, {
      ...init,
      headers,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed"
    const runningLocally =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    if (runningLocally) {
      throw new Error(`API unavailable at ${targetUrl}. Start the backend with 'bun run dev:server'. (${message})`)
    }
    throw new Error(
      `API unavailable at ${targetUrl}. Deploy the backend API and set VITE_API_BASE_URL in Vercel (or serve /api on this domain). (${message})`,
    )
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    const isCoreRoute = path === "/api/state" || path === "/api/health" || path === "/api/stream"
    if (response.status === 404 && !API_BASE_URL && isCoreRoute) {
      throw new Error(
        "API route not found on this host. Deploy backend endpoints under /api or set VITE_API_BASE_URL to your backend URL.",
      )
    }
    throw new Error(payload.error ?? `Request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

function publishState(nextState: TrackerState) {
  stateCache.users = nextState.users
  stateCache.races = nextState.races
  stateCache.bets = nextState.bets
  stateCache.userStats = nextState.userStats
  stateCache.globalStats = nextState.globalStats
  stateCache.version = nextState.version

  usersListeners.forEach((callback) => callback(stateCache.users))
  racesListeners.forEach((callback) => callback(stateCache.races))
  betsListeners.forEach((callback) => callback(stateCache.bets))
  userStatsListeners.forEach((callback) => callback(stateCache.userStats))
  globalStatsListeners.forEach((callback) => callback(stateCache.globalStats))
}

async function ensureStream(): Promise<void> {
  if (streamInitPromise) {
    await streamInitPromise
    return
  }

  const gen = streamGeneration

  streamInitPromise = (async () => {
    const initial = await request<TrackerState>("/api/state")

    // Stale: transport was closed while the request was in flight
    if (streamGeneration !== gen) return

    publishState(initial)
    stream = new EventSource(apiUrl("/api/stream"))
    stream.addEventListener("state", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as TrackerState
      publishState(parsed)
    })

    stream.onerror = () => {
      // browser EventSource handles retries; state refreshes on reconnect.
    }
  })()

  try {
    await streamInitPromise
  } catch (error) {
    closeRealtimeTransport()
    throw error
  }
}

function makeSubscription<T>(
  listeners: Set<(payload: T) => void>,
  selector: () => T,
  callback: (payload: T) => void,
): () => void {
  listeners.add(callback)
  callback(selector())

  void ensureStream().catch(() => {
    // bootstrapSeason in useTrackerData surfaces connection errors to UI.
  })

  return () => {
    listeners.delete(callback)

    if (
      usersListeners.size === 0 &&
      racesListeners.size === 0 &&
      betsListeners.size === 0 &&
      userStatsListeners.size === 0 &&
      globalStatsListeners.size === 0
    ) {
      closeRealtimeTransport()
    }
  }
}

export async function bootstrapSeason(): Promise<void> {
  await request<{ ok: true }>("/api/bootstrap", { method: "POST" })
}

export async function initializeTrackerData(): Promise<void> {
  await ensureStream()
}

export function subscribeUsers(callback: (users: UserProfile[]) => void): () => void {
  return makeSubscription(usersListeners, () => stateCache.users, callback)
}

export function subscribeRaces(callback: (races: Race[]) => void): () => void {
  return makeSubscription(racesListeners, () => stateCache.races, callback)
}

export function subscribeBets(callback: (bets: Bet[]) => void): () => void {
  return makeSubscription(betsListeners, () => stateCache.bets, callback)
}

export function subscribeUserStats(callback: (stats: UserStats[]) => void): () => void {
  return makeSubscription(userStatsListeners, () => stateCache.userStats, callback)
}

export function subscribeGlobalStats(callback: (stats: GlobalStats | null) => void): () => void {
  return makeSubscription(globalStatsListeners, () => stateCache.globalStats, callback)
}

export async function createBet(input: BetDraftInput, _races?: Race[]): Promise<void> {
  void _races
  await request<{ ok: true }>("/api/bets", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateBet(
  betId: string,
  input: BetDraftInput,
  _races?: Race[],
  _currentBet?: Bet,
): Promise<void> {
  void _races
  void _currentBet
  await request<{ ok: true }>(`/api/bets/${betId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export async function removeBet(bet: Bet): Promise<void> {
  await request<{ ok: true }>(`/api/bets/${bet.id}`, {
    method: "DELETE",
  })
}

export async function resolveOtherBetManually(input: { betId: string; totalReturn: number }): Promise<void> {
  await request<{ ok: true }>(`/api/bets/${input.betId}/manual-settle`, {
    method: "POST",
    body: JSON.stringify({ totalReturn: input.totalReturn }),
  })
}

export async function manuallyEditBet(input: ManualBetEditInput & { betId: string }): Promise<void> {
  await request<{ ok: true }>(`/api/bets/${input.betId}/manual-edit`, {
    method: "POST",
    body: JSON.stringify({
      userId: input.userId,
      betType: input.betType,
      betName: input.betName,
      legs: input.legs,
      oddsUsed: input.oddsUsed,
      stakeTotal: input.stakeTotal,
      isFreeBet: input.isFreeBet,
      ewTerms: input.ewTerms,
      status: input.status,
      totalReturn: input.totalReturn ?? null,
    }),
  })
}

export async function recomputeAndPersistStats(): Promise<void> {
  await request<{ ok: true }>("/api/stats/recompute", { method: "POST" })
}

export async function publishDailySummary(stats: GlobalStats): Promise<void> {
  await request<{ ok: true }>("/api/notifications/daily-summary", {
    method: "POST",
    body: JSON.stringify(stats),
  })
}

export async function refreshRaceData(): Promise<RaceImportRefreshResponse> {
  return await request<RaceImportRefreshResponse>("/api/import/races/refresh", {
    method: "POST",
  })
}

export async function getLastRaceImportRun(): Promise<RaceImportRun | null> {
  const payload = await request<{ run: RaceImportRun | null }>("/api/import/races/last-run", {
    method: "GET",
  })
  return payload.run
}
