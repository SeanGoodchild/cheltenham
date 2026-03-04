import { parseISO } from "date-fns"

import type {
  Bet,
  BetLeg,
  BetStatus,
  GlobalStats,
  LegResult,
  Race,
  UserProfile,
  UserStats,
} from "@/lib/types"
import { normalizeHorseName } from "@/lib/horse"

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function deriveLockAt(legs: Array<Pick<BetLeg, "raceId">>, races: Race[]): string {
  const times = legs
    .map((leg) => races.find((race) => race.id === leg.raceId)?.offTime)
    .filter((value): value is string => Boolean(value))

  if (!times.length) {
    throw new Error("Unable to derive lock time: one or more races are missing")
  }

  return times.sort((a, b) => parseISO(a).getTime() - parseISO(b).getTime())[0]
}

export function validateRunnerSelection(selectionName: string, race: Race): boolean {
  const normalizedSelection = normalizeHorseName(selectionName)
  return race.runners.some((runner) => normalizeHorseName(runner) === normalizedSelection)
}

export function deriveLegResult(selectionName: string, race: Race): LegResult {
  const normalizedSelection = normalizeHorseName(selectionName)

  if (race.result.winner && normalizeHorseName(race.result.winner) === normalizedSelection) {
    return "win"
  }

  if (race.result.placed.some((entry) => normalizeHorseName(entry) === normalizedSelection)) {
    return "place"
  }

  if (!race.result.winner && race.result.placed.length === 0) {
    return "pending"
  }

  return "lose"
}

export function getDerivedBetStatus(bet: Bet, nowIso: string): BetStatus {
  if (bet.status === "settled" || bet.status === "void") {
    return bet.status
  }

  return parseISO(nowIso).getTime() > parseISO(bet.lockAt).getTime() ? "locked" : "open"
}

function calculateSingleReturn(stake: number, odds: number, legResult: LegResult): number {
  if (legResult === "win") {
    return stake * odds
  }
  if (legResult === "void") {
    return stake
  }
  return 0
}

function calculateEachWayReturn(
  stakeTotal: number,
  odds: number,
  legResult: LegResult,
  placeFraction: number,
): number {
  const winStake = stakeTotal / 2
  const placeStake = stakeTotal / 2

  const winReturn =
    legResult === "win" ? winStake * odds : legResult === "void" ? winStake : 0

  const placeOdds = 1 + (odds - 1) * placeFraction
  const placeReturn =
    legResult === "win" || legResult === "place"
      ? placeStake * placeOdds
      : legResult === "void"
        ? placeStake
        : 0

  return winReturn + placeReturn
}

function calculateAccumulatorReturn(stake: number, legs: BetLeg[]): number {
  if (legs.some((leg) => leg.result === "lose")) {
    return 0
  }

  const allResolved = legs.every((leg) => leg.result !== "pending")
  if (!allResolved) {
    return 0
  }

  const combinedOdds = legs.reduce((acc, leg) => {
    if (leg.result === "void") {
      return acc
    }
    return acc * leg.decimalOdds
  }, 1)

  return stake * combinedOdds
}

export function isBetSettleable(bet: Bet): boolean {
  if (bet.betType === "accumulator") {
    return bet.legs.some((leg) => leg.result === "lose") || bet.legs.every((leg) => leg.result !== "pending")
  }

  return bet.legs.every((leg) => leg.result !== "pending")
}

export function calculateBetReturn(bet: Bet): number {
  const firstLeg = bet.legs[0]
  if (!firstLeg) {
    return 0
  }

  if (bet.betType === "single" || bet.betType === "other") {
    return calculateSingleReturn(bet.stakeTotal, firstLeg.decimalOdds, firstLeg.result)
  }

  if (bet.betType === "each_way") {
    const placeFraction = bet.ewTerms?.placeFraction ?? 0.2
    return calculateEachWayReturn(bet.stakeTotal, firstLeg.decimalOdds, firstLeg.result, placeFraction)
  }

  return calculateAccumulatorReturn(bet.stakeTotal, bet.legs)
}

export function computeUserStats(user: UserProfile, bets: Bet[]): UserStats {
  const userBets = bets.filter((bet) => bet.userId === user.id)

  const totalStaked = roundMoney(userBets.reduce((acc, bet) => acc + bet.stakeTotal, 0))
  const totalReturns = roundMoney(userBets.reduce((acc, bet) => acc + (bet.totalReturn ?? 0), 0))
  const profitLoss = roundMoney(totalReturns - totalStaked)
  const betsPlaced = userBets.length
  const settledBets = userBets.filter((bet) => bet.status === "settled")
  const settledWins = settledBets.filter((bet) => (bet.totalReturn ?? 0) > 0).length

  const roasPct = totalStaked > 0 ? roundMoney((totalReturns / totalStaked) * 100) : 0
  const winPct = settledBets.length > 0 ? roundMoney((settledWins / settledBets.length) * 100) : 0
  const biggestWin = roundMoney(
    settledBets.reduce((acc, bet) => Math.max(acc, bet.profitLoss ?? 0), 0),
  )
  const averageStake = betsPlaced > 0 ? roundMoney(totalStaked / betsPlaced) : 0

  return {
    userId: user.id,
    totalStaked,
    totalReturns,
    profitLoss,
    roasPct,
    winPct,
    betsPlaced,
    biggestWin,
    averageStake,
  }
}

export function computeGlobalStats(bets: Bet[], users: UserProfile[], nowIso: string): GlobalStats {
  const byUser = users.map((user) => computeUserStats(user, bets))
  const totalStaked = roundMoney(byUser.reduce((acc, stat) => acc + stat.totalStaked, 0))
  const totalReturns = roundMoney(byUser.reduce((acc, stat) => acc + stat.totalReturns, 0))
  const betsPlaced = byUser.reduce((acc, stat) => acc + stat.betsPlaced, 0)
  const averageStake = betsPlaced > 0 ? roundMoney(totalStaked / betsPlaced) : 0
  const roasPct = totalStaked > 0 ? roundMoney((totalReturns / totalStaked) * 100) : 0

  const settledBets = bets.filter((bet) => bet.status === "settled")
  const settledWins = settledBets.filter((bet) => (bet.totalReturn ?? 0) > 0).length
  const winPct = settledBets.length > 0 ? roundMoney((settledWins / settledBets.length) * 100) : 0

  const biggestWinner = byUser.sort((a, b) => b.biggestWin - a.biggestWin)[0]

  return {
    totalStaked,
    totalReturns,
    averageStake,
    roasPct,
    winPct,
    betsPlaced,
    biggestWin: biggestWinner?.biggestWin ?? 0,
    biggestWinUserId: biggestWinner?.userId,
    updatedAt: nowIso,
  }
}

export function toCumulativeSeries(bets: Bet[]): Array<{ label: string; value: number }> {
  const settled = bets
    .filter((bet) => bet.status === "settled")
    .sort((a, b) => {
      const aTime = parseISO(a.settledAt ?? a.updatedAt).getTime()
      const bTime = parseISO(b.settledAt ?? b.updatedAt).getTime()
      return aTime - bTime
    })

  let cumulative = 0
  return settled.map((bet) => {
    cumulative += bet.profitLoss ?? 0
    return {
      label: new Date(bet.settledAt ?? bet.updatedAt).toLocaleString("en-GB", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
      value: roundMoney(cumulative),
    }
  })
}
