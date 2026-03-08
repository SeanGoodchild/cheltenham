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

export type RaceOutcomeRange = {
  raceId: string
  raceName: string
  offTime: string
  openPnl: number
  actualClosePnl?: number
  bestClosePnl: number
  worstClosePnl: number
  bestDelta: number
  worstDelta: number
  bestScenario: string
  worstScenario: string
  isForecast: boolean
}

type SimulatedRaceOutcome = {
  winner?: string
  placed: string[]
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function isValidOdds(value: number | undefined | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
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

export function getBetSettlementRaceId(bet: Bet, races: Race[]): string | null {
  if (!bet.legs.length) {
    return null
  }

  const legsWithRace = bet.legs
    .map((leg) => ({
      raceId: leg.raceId,
      offTime: races.find((race) => race.id === leg.raceId)?.offTime,
    }))
    .filter((entry): entry is { raceId: string; offTime: string } => Boolean(entry.offTime))

  if (!legsWithRace.length) {
    return null
  }

  return legsWithRace.sort((a, b) => parseISO(a.offTime).getTime() - parseISO(b.offTime).getTime()).at(-1)?.raceId ?? null
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

export function resolveBetOddsUsed(bet: Pick<Bet, "betType" | "oddsUsed" | "legs">): number | null {
  if (isValidOdds(bet.oddsUsed)) {
    return bet.oddsUsed
  }

  if (bet.betType === "accumulator") {
    if (!bet.legs.length) {
      return null
    }
    const combined = bet.legs.reduce((acc, leg) => {
      const odds = isValidOdds(leg.decimalOdds) ? leg.decimalOdds : 1
      return acc * odds
    }, 1)
    return isValidOdds(combined) ? roundMoney(combined) : null
  }

  if (bet.betType === "other") {
    return null
  }

  const firstLegOdds = bet.legs[0]?.decimalOdds
  return isValidOdds(firstLegOdds) ? firstLegOdds : null
}

function calculateAccumulatorReturn(stake: number, bet: Pick<Bet, "legs" | "oddsUsed" | "betType">): number {
  const legs = bet.legs
  if (legs.some((leg) => leg.result === "lose" || leg.result === "place")) {
    return 0
  }

  const allResolved = legs.every((leg) => leg.result !== "pending")
  if (!allResolved) {
    return 0
  }

  let combinedOdds = resolveBetOddsUsed(bet) ?? 1
  if (!isValidOdds(combinedOdds)) {
    combinedOdds = 1
  }

  const voidOddsFactor = legs.reduce((acc, leg) => {
    if (leg.result !== "void") {
      return acc
    }
    const legOdds = isValidOdds(leg.decimalOdds) ? leg.decimalOdds : 1
    return acc * legOdds
  }, 1)

  const adjustedOdds = Math.max(1, combinedOdds / Math.max(1, voidOddsFactor))
  return stake * adjustedOdds
}

export function isBetSettleable(bet: Bet): boolean {
  if (bet.betType === "accumulator") {
    return bet.legs.some((leg) => leg.result === "lose" || leg.result === "place") || bet.legs.every((leg) => leg.result !== "pending")
  }

  return bet.legs.every((leg) => leg.result !== "pending")
}

export function calculateBetReturn(bet: Bet): number {
  const firstLeg = bet.legs[0]
  if (!firstLeg) {
    return 0
  }

  const oddsUsed = resolveBetOddsUsed(bet)
  if (!isValidOdds(oddsUsed)) {
    return 0
  }

  if (bet.betType === "single" || bet.betType === "other") {
    return calculateSingleReturn(bet.stakeTotal, oddsUsed, firstLeg.result)
  }

  if (bet.betType === "each_way") {
    const placeFraction = bet.ewTerms?.placeFraction ?? 0.2
    return calculateEachWayReturn(bet.stakeTotal, oddsUsed, firstLeg.result, placeFraction)
  }

  return calculateAccumulatorReturn(bet.stakeTotal, bet)
}

export function calculateBetPotentialReturn(bet: Pick<Bet, "betType" | "stakeTotal" | "ewTerms" | "legs" | "oddsUsed">): number {
  const oddsUsed = resolveBetOddsUsed(bet)
  if (!isValidOdds(oddsUsed) || bet.stakeTotal <= 0) {
    return 0
  }

  if (bet.betType === "each_way") {
    const placeFraction = bet.ewTerms?.placeFraction ?? 0.2
    return calculateEachWayReturn(bet.stakeTotal, oddsUsed, "win", placeFraction)
  }

  return bet.stakeTotal * oddsUsed
}

export function computeUserStats(user: UserProfile, bets: Bet[]): UserStats {
  const userBets = bets.filter((bet) => bet.userId === user.id)
  const settledBets = userBets.filter((bet) => bet.status === "settled")
  const settledStaked = roundMoney(settledBets.reduce((acc, bet) => acc + bet.stakeTotal, 0))
  const oddsValues = userBets
    .map((bet) => resolveBetOddsUsed(bet))
    .filter((value): value is number => isValidOdds(value))
  const averageOdds =
    oddsValues.length > 0
      ? roundMoney(oddsValues.reduce((acc, value) => acc + value, 0) / oddsValues.length)
      : 0

  const totalStaked = roundMoney(userBets.reduce((acc, bet) => acc + bet.stakeTotal, 0))
  const totalReturns = roundMoney(settledBets.reduce((acc, bet) => acc + (bet.totalReturn ?? 0), 0))
  const profitLoss = roundMoney(totalReturns - settledStaked)
  const betsPlaced = userBets.length
  const settledWins = settledBets.filter((bet) => (bet.totalReturn ?? 0) > 0).length

  const roasPct = settledStaked > 0 ? roundMoney((totalReturns / settledStaked) * 100) : 0
  const winPct = settledBets.length > 0 ? roundMoney((settledWins / settledBets.length) * 100) : 0
  const biggestLoss = roundMoney(
    settledBets.reduce((acc, bet) => Math.min(acc, bet.profitLoss ?? 0), 0),
  )
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
    averageOdds,
    biggestLoss,
    biggestWin,
    averageStake,
  }
}

export function computeGlobalStats(bets: Bet[], users: UserProfile[], nowIso: string): GlobalStats {
  const byUser = users.map((user) => computeUserStats(user, bets))
  const oddsValues = bets
    .map((bet) => resolveBetOddsUsed(bet))
    .filter((value): value is number => isValidOdds(value))
  const totalStaked = roundMoney(byUser.reduce((acc, stat) => acc + stat.totalStaked, 0))
  const totalReturns = roundMoney(byUser.reduce((acc, stat) => acc + stat.totalReturns, 0))
  const betsPlaced = byUser.reduce((acc, stat) => acc + stat.betsPlaced, 0)
  const averageStake = betsPlaced > 0 ? roundMoney(totalStaked / betsPlaced) : 0
  const averageOdds =
    oddsValues.length > 0
      ? roundMoney(oddsValues.reduce((acc, value) => acc + value, 0) / oddsValues.length)
      : 0

  const settledBets = bets.filter((bet) => bet.status === "settled")
  const settledStaked = roundMoney(settledBets.reduce((acc, bet) => acc + bet.stakeTotal, 0))
  const settledWins = settledBets.filter((bet) => (bet.totalReturn ?? 0) > 0).length
  const roasPct = settledStaked > 0 ? roundMoney((totalReturns / settledStaked) * 100) : 0
  const winPct = settledBets.length > 0 ? roundMoney((settledWins / settledBets.length) * 100) : 0
  const biggestLoss = roundMoney(
    settledBets.reduce((acc, bet) => Math.min(acc, bet.profitLoss ?? 0), 0),
  )

  const biggestWinner = byUser.sort((a, b) => b.biggestWin - a.biggestWin)[0]

  return {
    totalStaked,
    totalReturns,
    averageStake,
    averageOdds,
    roasPct,
    winPct,
    betsPlaced,
    biggestLoss,
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

function uniqueHorseNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.filter((name) => {
    const normalized = normalizeHorseName(name)
    if (!normalized || seen.has(normalized)) {
      return false
    }
    seen.add(normalized)
    return true
  })
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count <= 0) {
    return [[]]
  }
  if (count > items.length) {
    return []
  }

  const result: T[][] = []
  const current: T[] = []

  function walk(start: number) {
    if (current.length === count) {
      result.push([...current])
      return
    }

    for (let index = start; index <= items.length - (count - current.length); index += 1) {
      current.push(items[index])
      walk(index + 1)
      current.pop()
    }
  }

  walk(0)
  return result
}

function formatScenario(outcome: SimulatedRaceOutcome): string {
  if (!outcome.winner) {
    return "No valid race outcome"
  }

  const winner = outcome.winner

  const placersExWinner = outcome.placed.filter(
    (entry) => normalizeHorseName(entry) !== normalizeHorseName(winner),
  )

  if (!placersExWinner.length) {
    return `${winner} wins`
  }

  return `${winner} wins, placed ${placersExWinner.join(", ")}`
}

function buildSimulatedRaceOutcomes(race: Race, bets: Bet[]): SimulatedRaceOutcome[] {
  const runners = uniqueHorseNames(
    (race.runnersDetailed?.length
      ? race.runnersDetailed.filter((runner) => !runner.nonRunner).map((runner) => runner.horseName)
      : race.runners) ?? [],
  )

  if (!runners.length) {
    return [{ winner: undefined, placed: [] }]
  }

  const placesPaid = Math.max(
    1,
    ...bets
      .filter((bet) => bet.betType === "each_way")
      .map((bet) => Math.max(1, bet.ewTerms?.placesPaid ?? 1)),
  )

  return runners.flatMap((winner) => {
    const otherRunners = runners.filter((runner) => normalizeHorseName(runner) !== normalizeHorseName(winner))
    const additionalPlacers = Math.max(0, Math.min(placesPaid - 1, otherRunners.length))
    const placerCombos = combinations(otherRunners, additionalPlacers)

    if (!placerCombos.length) {
      return [{ winner, placed: [winner] }]
    }

    return placerCombos.map((placers) => ({
      winner,
      placed: [winner, ...placers],
    }))
  })
}

function deriveLegResultForSimulatedOutcome(
  selectionName: string,
  betType: Bet["betType"],
  ewTerms: Bet["ewTerms"] | undefined,
  outcome: SimulatedRaceOutcome,
): LegResult {
  const normalizedSelection = normalizeHorseName(selectionName)
  const normalizedWinner = normalizeHorseName(outcome.winner ?? "")
  if (normalizedSelection && normalizedWinner && normalizedSelection === normalizedWinner) {
    return "win"
  }

  if (betType === "each_way") {
    const allowedPlacers = outcome.placed.slice(0, Math.max(1, ewTerms?.placesPaid ?? 1))
    if (allowedPlacers.some((entry) => normalizeHorseName(entry) === normalizedSelection)) {
      return "place"
    }
  }

  return "lose"
}

function getLegResultAtRace(
  bet: Bet,
  leg: BetLeg,
  targetRace: Race,
  racesById: Map<string, Race>,
  outcome: SimulatedRaceOutcome,
): LegResult {
  if (leg.raceId === targetRace.id) {
    return deriveLegResultForSimulatedOutcome(leg.selectionName, bet.betType, bet.ewTerms, outcome)
  }

  const race = racesById.get(leg.raceId)
  if (!race) {
    return "pending"
  }

  const legRaceTime = parseISO(race.offTime).getTime()
  const targetRaceTime = parseISO(targetRace.offTime).getTime()
  if (legRaceTime >= targetRaceTime) {
    return "pending"
  }

  return deriveLegResult(leg.selectionName, race)
}

function calculateProjectedProfitLossForOutcome(
  bet: Bet,
  targetRace: Race,
  racesById: Map<string, Race>,
  outcome: SimulatedRaceOutcome,
): number {
  if (bet.betType === "other") {
    return 0
  }

  const projectedBet: Bet = {
    ...bet,
    legs: bet.legs.map((leg) => ({
      ...leg,
      result: getLegResultAtRace(bet, leg, targetRace, racesById, outcome),
    })),
  }

  const totalReturn = calculateBetReturn(projectedBet)
  return roundMoney(totalReturn - bet.stakeTotal)
}

export function buildRaceOutcomeRanges(races: Race[], bets: Bet[]): RaceOutcomeRange[] {
  const racesById = new Map(races.map((race) => [race.id, race]))
  const sortedRaces = [...races].sort((a, b) => parseISO(a.offTime).getTime() - parseISO(b.offTime).getTime())
  const displayRaces = sortedRaces

  if (!displayRaces.length) {
    return []
  }

  const actualPnlBySettlementRace = new Map<string, number>()
  bets
    .filter((bet) => bet.status === "settled")
    .forEach((bet) => {
      const settlementRaceId = getBetSettlementRaceId(bet, races)
      if (!settlementRaceId) {
        return
      }

      actualPnlBySettlementRace.set(
        settlementRaceId,
        roundMoney((actualPnlBySettlementRace.get(settlementRaceId) ?? 0) + (bet.profitLoss ?? 0)),
      )
    })

  let cumulativeActual = 0

  return displayRaces.map((race) => {
    const openPnl = cumulativeActual
    const settlementBets = bets.filter((bet) => {
      if (bet.betType === "other") {
        return false
      }
      return getBetSettlementRaceId(bet, races) === race.id
    })

    let bestDelta = 0
    let worstDelta = 0
    let bestScenario = "No betting swing"
    let worstScenario = "No betting swing"

    if (settlementBets.length > 0) {
      const outcomes = buildSimulatedRaceOutcomes(race, settlementBets)
      let bestOutcomeValue = Number.NEGATIVE_INFINITY
      let worstOutcomeValue = Number.POSITIVE_INFINITY

      outcomes.forEach((outcome) => {
        const delta = roundMoney(
          settlementBets.reduce(
            (acc, bet) => acc + calculateProjectedProfitLossForOutcome(bet, race, racesById, outcome),
            0,
          ),
        )

        if (delta > bestOutcomeValue) {
          bestOutcomeValue = delta
          bestDelta = delta
          bestScenario = formatScenario(outcome)
        }

        if (delta < worstOutcomeValue) {
          worstOutcomeValue = delta
          worstDelta = delta
          worstScenario = formatScenario(outcome)
        }
      })
    }

    const actualDelta = roundMoney(actualPnlBySettlementRace.get(race.id) ?? 0)
    const actualClosePnl = race.status === "settled" ? roundMoney(openPnl + actualDelta) : undefined
    const bestClosePnl = roundMoney(openPnl + bestDelta)
    const worstClosePnl = roundMoney(openPnl + worstDelta)

    if (race.status === "settled") {
      cumulativeActual = actualClosePnl ?? cumulativeActual
    }

    return {
      raceId: race.id,
      raceName: race.name,
      offTime: race.offTime,
      openPnl,
      actualClosePnl,
      bestClosePnl,
      worstClosePnl,
      bestDelta,
      worstDelta,
      bestScenario,
      worstScenario,
      isForecast: race.status !== "settled",
    }
  })
}
