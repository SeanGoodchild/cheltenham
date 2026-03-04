import type { Bet, GlobalStats, Race, RaceDay, RaceImportRun, UserProfile, UserStats } from "@/lib/types"

export type BetDraftInput = {
  userId: string
  betType: Bet["betType"]
  legs: Array<{
    raceId: string
    selectionName: string
    decimalOdds: number
    horseUid?: number
  }>
  stakeTotal: number
  ewTerms?: {
    placesPaid: number
    placeFraction: number
  }
}

export type RaceDraftInput = {
  day: RaceDay
  offTime: string
  name: string
  runners: string[]
}

export type RaceResultInput = {
  raceId: string
  winner?: string
  placed: string[]
}

export type RaceImportRefreshResponse = {
  ok: true
  run: RaceImportRun
}

export type RaceImportLockInput = {
  raceId: string
  locked: boolean
  reason?: string
}

type TrackerState = {
  users: UserProfile[]
  races: Race[]
  bets: Bet[]
  userStats: UserStats[]
  globalStats: GlobalStats | null
  version: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001"

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed"
    throw new Error(
      `API unavailable at ${API_BASE_URL}. Start the backend with 'bun run dev:server'. (${message})`,
    )
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
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

  streamInitPromise = (async () => {
    const initial = await request<TrackerState>("/api/state")
    publishState(initial)

    stream = new EventSource(`${API_BASE_URL}/api/stream`)
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
    streamInitPromise = null
    stream?.close()
    stream = null
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
      stream?.close()
      stream = null
      streamInitPromise = null
    }
  }
}

export async function bootstrapSeason(): Promise<void> {
  await request<{ ok: true }>("/api/bootstrap", { method: "POST" })
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

export async function createRace(input: RaceDraftInput): Promise<void> {
  await request<{ ok: true }>("/api/races", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateRaceResult(input: RaceResultInput): Promise<void> {
  await request<{ ok: true }>(`/api/races/${input.raceId}/result`, {
    method: "POST",
    body: JSON.stringify({ winner: input.winner, placed: input.placed }),
  })
}

export async function settleRace(raceId: string): Promise<void> {
  await request<{ ok: true }>(`/api/races/${raceId}/settle`, {
    method: "POST",
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

export async function setRaceImportLock(input: RaceImportLockInput): Promise<void> {
  await request<{ ok: true }>(`/api/races/${input.raceId}/import-lock`, {
    method: "POST",
    body: JSON.stringify({ locked: input.locked, reason: input.reason }),
  })
}
