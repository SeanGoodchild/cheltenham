import type { Race } from "./types.js"

export const RESULT_PENDING_CUTOFF_MINUTES = 20

export function isRaceResultPendingExpired(
  race: Pick<Race, "status" | "offTime">,
  nowMs = Date.now(),
  cutoffMinutes = RESULT_PENDING_CUTOFF_MINUTES,
): boolean {
  if (race.status !== "result_pending") {
    return false
  }

  return nowMs - new Date(race.offTime).getTime() >= cutoffMinutes * 60_000
}

export function isRaceAwaitingResults(
  race: Pick<Race, "status" | "offTime">,
  nowMs = Date.now(),
  cutoffMinutes = RESULT_PENDING_CUTOFF_MINUTES,
): boolean {
  return race.status !== "settled" && !isRaceResultPendingExpired(race, nowMs, cutoffMinutes)
}

export function getNextRelevantRace(
  races: Race[],
  nowMs = Date.now(),
  cutoffMinutes = RESULT_PENDING_CUTOFF_MINUTES,
): Race | null {
  const orderedRaces = [...races].sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())

  return (
    orderedRaces.find((race) => new Date(race.offTime).getTime() > nowMs) ??
    orderedRaces.find((race) => isRaceAwaitingResults(race, nowMs, cutoffMinutes)) ??
    null
  )
}
