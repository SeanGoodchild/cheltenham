import type { Bet, Race, UserProfile } from "@/lib/types"
import {
  calculateBetPotentialProfit,
  calculateBetPotentialReturn,
  computeGlobalStats,
  computeUserStats,
  getBetRiskStake,
  getBetSettlementRaceId,
  getDerivedBetStatus,
  resolveBetOddsUsed,
} from "@/lib/settlement"

type TrackerStateInput = {
  users: UserProfile[]
  races: Race[]
  bets: Bet[]
}

export type GeminiBetSummary = {
  betId: string
  betType: Bet["betType"]
  betName: string | null
  status: Bet["status"]
  isFreeBet: boolean
  stakeTotal: number
  riskStake: number
  resolvedOdds: number | null
  potentialReturn: number
  potentialProfit: number
  potentialWin: number
  potentialLoss: number
  settledReturn: number | null
  profitLoss: number | null
  profit: number | null
  loss: number | null
  settlementRaceId: string | null
  createdAt: string
  settledAt: string | null
  legs: Array<{
    raceId: string
    selectionName: string
    decimalOdds: number
    result: Bet["legs"][number]["result"]
  }>
}

export type GeminiRaceUserSummary = {
  displayName: string
  betsCount: number
  stakeTotal: number
  riskStake: number
  settledReturn: number
  profitLoss: number
  winningSelections: string[]
  placedSelections: string[]
  losingSelections: string[]
  bets: GeminiBetSummary[]
}

export type GeminiRaceSummary = {
  name: string
  day: Race["day"]
  offTime: string
  status: Race["status"]
  lifecycle: Race["lifecycle"]
  winner: string | null
  placed: string[]
  marketFavourite: {
    horseName: string
    bestFractional: string
    bestDecimal: number
  } | null
  hasBets: boolean
  users: Record<string, GeminiRaceUserSummary>
}

export type GeminiTrackerSummary = {
  overview: {
    betsPlaced: number
    totalStaked: number
    settledStakeTotal: number
    totalReturns: number
    settledProfitLoss: number
    openStake: number
    winPct: number
    roasPct: number
    openBetsCount: number
    raceStatus: {
      upcoming: number
      inProgress: number
      complete: number
    }
    leader: {
      userId: string
      displayName: string
      profitLoss: number
    } | null
    biggestLoser: {
      userId: string
      displayName: string
      profitLoss: number
    } | null
    nextRace: {
      raceId: string
      name: string
      offTime: string
      status: Race["status"]
      marketFavourite: string | null
    } | null
    lastSettledRace: {
      raceId: string
      name: string
      offTime: string
      winner: string | null
    } | null
  }
  races: Record<string, GeminiRaceSummary>
}

export type GeminiRaceResultNotificationSummary = {
  race: {
    raceId: string
    name: string
    day: Race["day"]
    offTime: string
    status: Race["status"]
    lifecycle: Race["lifecycle"]
    winner: string | null
    placed: string[]
    marketFavourite: GeminiRaceSummary["marketFavourite"]
    users: Record<string, GeminiRaceUserSummary>
  }
  standings: Array<{
    userId: string
    displayName: string
    profitLoss: number
    betsPlaced: number
    totalStaked: number
    totalReturns: number
    openStake: number
    winPct: number
  }>
  nextRace: {
    raceId: string
    name: string
    day: Race["day"]
    offTime: string
    status: Race["status"]
    marketFavourite: GeminiRaceSummary["marketFavourite"]
    openSelections: Array<{
      userId: string
      displayName: string
      totalStake: number
      selections: string[]
    }>
  } | null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function formatMoneyGBP(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatCompactMoney(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${formatMoneyGBP(Math.abs(value))}`
}

function getNextRaceForSummary(races: Race[], now = Date.now()): Race | null {
  const upcoming = races
    .filter((race) => race.status !== "settled" && new Date(race.offTime).getTime() > now)
    .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())[0]
  if (upcoming) {
    return upcoming
  }

  return (
    races
      .filter((race) => race.status !== "settled")
      .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())[0] ?? null
  )
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (!value || seen.has(value)) {
      return false
    }
    seen.add(value)
    return true
  })
}

function compareBets(a: GeminiBetSummary, b: GeminiBetSummary): number {
  const createdAtCompare = a.createdAt.localeCompare(b.createdAt)
  if (createdAtCompare !== 0) {
    return createdAtCompare
  }
  return a.betId.localeCompare(b.betId)
}

export function buildGeminiTrackerSummary(
  state: TrackerStateInput,
  nowIso = new Date().toISOString(),
): GeminiTrackerSummary {
  const betsWithDerivedStatus = state.bets.map((bet) => ({
    ...bet,
    status: getDerivedBetStatus(bet, nowIso),
  }))
  const computedUserStats = state.users.map((user) => computeUserStats(user, betsWithDerivedStatus))
  const computedGlobalStats = computeGlobalStats(betsWithDerivedStatus, state.users, nowIso)
  const usersById = new Map(state.users.map((user) => [user.id, user]))
  const settledBets = betsWithDerivedStatus.filter((bet) => bet.status === "settled")
  const openBets = betsWithDerivedStatus.filter((bet) => bet.status === "open" || bet.status === "locked")
  const settledStakeTotal = roundMoney(settledBets.reduce((acc, bet) => acc + bet.stakeTotal, 0))
  const totalProfitLoss = roundMoney(computedUserStats.reduce((acc, stat) => acc + stat.profitLoss, 0))

  const sortedUserStats = [...computedUserStats].sort((a, b) => {
    if (a.profitLoss !== b.profitLoss) {
      return b.profitLoss - a.profitLoss
    }
    const aName = usersById.get(a.userId)?.displayName ?? a.userId
    const bName = usersById.get(b.userId)?.displayName ?? b.userId
    return aName.localeCompare(bName)
  })

  const topUser = sortedUserStats[0] ?? null
  const bottomUser = [...sortedUserStats].sort((a, b) => {
    if (a.profitLoss !== b.profitLoss) {
      return a.profitLoss - b.profitLoss
    }
    const aName = usersById.get(a.userId)?.displayName ?? a.userId
    const bName = usersById.get(b.userId)?.displayName ?? b.userId
    return aName.localeCompare(bName)
  })[0] ?? null

  const nextRace = getNextRaceForSummary(state.races)
  const lastSettledRace =
    [...state.races]
      .filter((race) => race.status === "settled")
      .sort((a, b) => new Date(b.offTime).getTime() - new Date(a.offTime).getTime())[0] ?? null

  const raceStatusCounts = {
    upcoming: state.races.filter((race) => race.lifecycle === "upcoming").length,
    inProgress: state.races.filter((race) => race.lifecycle === "in_progress").length,
    complete: state.races.filter((race) => race.lifecycle === "complete").length,
  }

  const raceIdsWithBets = new Set(betsWithDerivedStatus.flatMap((bet) => bet.legs.map((leg) => leg.raceId)))
  const includedRaces = [...state.races]
    .filter((race) => race.status === "settled" || raceIdsWithBets.has(race.id))
    .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())

  const races: Record<string, GeminiRaceSummary> = {}

  includedRaces.forEach((race) => {
    const raceBets = betsWithDerivedStatus.filter((bet) => bet.legs.some((leg) => leg.raceId === race.id))
    const users: Record<string, GeminiRaceUserSummary> = {}

    const usersWithRaceBets = [...state.users]
      .filter((user) => raceBets.some((bet) => bet.userId === user.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))

    usersWithRaceBets.forEach((user) => {
      const userRaceBets = raceBets.filter((bet) => bet.userId === user.id)

      const betSummaries = userRaceBets
        .map((bet): GeminiBetSummary => {
          const riskStake = roundMoney(getBetRiskStake(bet))
          const resolvedOdds = resolveBetOddsUsed(bet)
          const potentialReturn = roundMoney(calculateBetPotentialReturn(bet))
          const potentialProfit = roundMoney(calculateBetPotentialProfit(bet))
          const settledReturn = bet.status === "settled" ? roundMoney(bet.totalReturn ?? 0) : null
          const profitLoss = bet.status === "settled" ? roundMoney(bet.profitLoss ?? 0) : null

          return {
            betId: bet.id,
            betType: bet.betType,
            betName: bet.betName ?? null,
            status: bet.status,
            isFreeBet: Boolean(bet.isFreeBet),
            stakeTotal: roundMoney(bet.stakeTotal),
            riskStake,
            resolvedOdds,
            potentialReturn,
            potentialProfit,
            potentialWin: potentialProfit,
            potentialLoss: riskStake,
            settledReturn,
            profitLoss,
            profit: profitLoss === null ? null : Math.max(0, profitLoss),
            loss: profitLoss === null ? null : Math.max(0, -profitLoss),
            settlementRaceId: getBetSettlementRaceId(bet, state.races),
            createdAt: bet.createdAt,
            settledAt: bet.settledAt ?? null,
            legs: bet.legs.map((leg) => ({
              raceId: leg.raceId,
              selectionName: leg.selectionName,
              decimalOdds: leg.decimalOdds,
              result: leg.result,
            })),
          }
        })
        .sort(compareBets)

      const legsForRace = userRaceBets.flatMap((bet) => bet.legs.filter((leg) => leg.raceId === race.id))

      users[user.id] = {
        displayName: user.displayName,
        betsCount: betSummaries.length,
        stakeTotal: roundMoney(betSummaries.reduce((acc, bet) => acc + bet.stakeTotal, 0)),
        riskStake: roundMoney(betSummaries.reduce((acc, bet) => acc + bet.riskStake, 0)),
        settledReturn: roundMoney(betSummaries.reduce((acc, bet) => acc + (bet.settledReturn ?? 0), 0)),
        profitLoss: roundMoney(betSummaries.reduce((acc, bet) => acc + (bet.profitLoss ?? 0), 0)),
        winningSelections: uniqueStrings(
          legsForRace.filter((leg) => leg.result === "win").map((leg) => leg.selectionName),
        ),
        placedSelections: uniqueStrings(
          legsForRace.filter((leg) => leg.result === "place").map((leg) => leg.selectionName),
        ),
        losingSelections: uniqueStrings(
          legsForRace.filter((leg) => leg.result === "lose").map((leg) => leg.selectionName),
        ),
        bets: betSummaries,
      }
    })

    races[race.id] = {
      name: race.name,
      day: race.day,
      offTime: race.offTime,
      status: race.status,
      lifecycle: race.lifecycle,
      winner: race.result.winner ?? null,
      placed: race.result.placed,
      marketFavourite: race.marketFavourite
        ? {
            horseName: race.marketFavourite.horseName,
            bestFractional: race.marketFavourite.bestFractional,
            bestDecimal: race.marketFavourite.bestDecimal,
          }
        : null,
      hasBets: raceBets.length > 0,
      users,
    }
  })

  return {
    overview: {
      betsPlaced: computedGlobalStats.betsPlaced,
      totalStaked: roundMoney(computedGlobalStats.totalStaked),
      settledStakeTotal,
      totalReturns: roundMoney(computedGlobalStats.totalReturns),
      settledProfitLoss: totalProfitLoss,
      openStake: roundMoney(openBets.reduce((acc, bet) => acc + bet.stakeTotal, 0)),
      winPct: computedGlobalStats.winPct,
      roasPct: computedGlobalStats.roasPct,
      openBetsCount: openBets.length,
      raceStatus: raceStatusCounts,
      leader: topUser
        ? {
            userId: topUser.userId,
            displayName: usersById.get(topUser.userId)?.displayName ?? topUser.userId,
            profitLoss: roundMoney(topUser.profitLoss),
          }
        : null,
      biggestLoser: bottomUser
        ? {
            userId: bottomUser.userId,
            displayName: usersById.get(bottomUser.userId)?.displayName ?? bottomUser.userId,
            profitLoss: roundMoney(bottomUser.profitLoss),
          }
        : null,
      nextRace: nextRace
        ? {
            raceId: nextRace.id,
            name: nextRace.name,
            offTime: nextRace.offTime,
            status: nextRace.status,
            marketFavourite: nextRace.marketFavourite?.horseName ?? null,
          }
        : null,
      lastSettledRace: lastSettledRace
        ? {
            raceId: lastSettledRace.id,
            name: lastSettledRace.name,
            offTime: lastSettledRace.offTime,
            winner: lastSettledRace.result.winner ?? null,
          }
        : null,
    },
    races,
  }
}

export function buildGeminiTrackerSummaryText(
  state: TrackerStateInput,
  nowIso = new Date().toISOString(),
): string {
  const summary = buildGeminiTrackerSummary(state, nowIso)
  const { overview } = summary
  const lines = [
    "Cheltenham Tracker Summary",
    `Overall: ${overview.betsPlaced} bets, ${formatMoneyGBP(overview.totalStaked)} staked, ${formatMoneyGBP(overview.totalReturns)} settled returns, settled P&L ${formatCompactMoney(overview.settledProfitLoss)}, open stake ${formatMoneyGBP(overview.openStake)}, win rate ${overview.winPct}%, ROAS ${overview.roasPct}%.`,
    overview.leader
      ? `Leader: ${overview.leader.displayName} ${formatCompactMoney(overview.leader.profitLoss)}.`
      : "Leader: none.",
    overview.biggestLoser
      ? `Biggest loser: ${overview.biggestLoser.displayName} ${formatCompactMoney(overview.biggestLoser.profitLoss)}.`
      : "Biggest loser: none.",
    overview.lastSettledRace
      ? `Last settled race: ${overview.lastSettledRace.name}. Winner: ${overview.lastSettledRace.winner ?? "unknown"}.`
      : "Last settled race: none.",
    overview.nextRace
      ? `Next race: ${overview.nextRace.name} at ${overview.nextRace.offTime} (${overview.nextRace.status}). Favourite: ${overview.nextRace.marketFavourite ?? "unknown"}.`
      : "Next race: none scheduled.",
    "Tracker JSON:",
    JSON.stringify(summary),
  ]

  return lines.join("\n")
}

export function buildGeminiRaceResultNotificationSummary(
  state: TrackerStateInput,
  raceId: string,
  nowIso = new Date().toISOString(),
): GeminiRaceResultNotificationSummary {
  const summary = buildGeminiTrackerSummary(state, nowIso)
  const targetRace = state.races.find((race) => race.id === raceId)

  if (!targetRace) {
    throw new Error(`Race ${raceId} not found for Gemini race-result summary`)
  }

  const raceSummary = summary.races[raceId] ?? {
    name: targetRace.name,
    day: targetRace.day,
    offTime: targetRace.offTime,
    status: targetRace.status,
    lifecycle: targetRace.lifecycle,
    winner: targetRace.result.winner ?? null,
    placed: targetRace.result.placed,
    marketFavourite: targetRace.marketFavourite
      ? {
          horseName: targetRace.marketFavourite.horseName,
          bestFractional: targetRace.marketFavourite.bestFractional,
          bestDecimal: targetRace.marketFavourite.bestDecimal,
        }
      : null,
    hasBets: false,
    users: {},
  }

  const betsWithDerivedStatus = state.bets.map((bet) => ({
    ...bet,
    status: getDerivedBetStatus(bet, nowIso),
  }))
  const computedUserStats = state.users.map((user) => computeUserStats(user, betsWithDerivedStatus))
  const openBets = betsWithDerivedStatus.filter((bet) => bet.status === "open" || bet.status === "locked")
  const nextRace = getNextRaceForSummary(state.races, new Date(nowIso).getTime())

  const standings = computedUserStats
    .map((stat) => ({
      userId: stat.userId,
      displayName: state.users.find((user) => user.id === stat.userId)?.displayName ?? stat.userId,
      profitLoss: roundMoney(stat.profitLoss),
      betsPlaced: stat.betsPlaced,
      totalStaked: roundMoney(stat.totalStaked),
      totalReturns: roundMoney(stat.totalReturns),
      openStake: roundMoney(
        openBets.filter((bet) => bet.userId === stat.userId).reduce((acc, bet) => acc + bet.stakeTotal, 0),
      ),
      winPct: stat.winPct,
    }))
    .sort((a, b) => {
      if (a.profitLoss !== b.profitLoss) {
        return b.profitLoss - a.profitLoss
      }
      return a.displayName.localeCompare(b.displayName)
    })

  const nextRaceSummary =
    nextRace === null
      ? null
      : {
          raceId: nextRace.id,
          name: nextRace.name,
          day: nextRace.day,
          offTime: nextRace.offTime,
          status: nextRace.status,
          marketFavourite: nextRace.marketFavourite
            ? {
                horseName: nextRace.marketFavourite.horseName,
                bestFractional: nextRace.marketFavourite.bestFractional,
                bestDecimal: nextRace.marketFavourite.bestDecimal,
              }
            : null,
          openSelections: state.users
            .map((user) => {
              const userBets = openBets.filter(
                (bet) => bet.userId === user.id && bet.legs.some((leg) => leg.raceId === nextRace.id),
              )

              return {
                userId: user.id,
                displayName: user.displayName,
                totalStake: roundMoney(userBets.reduce((acc, bet) => acc + bet.stakeTotal, 0)),
                selections: uniqueStrings(
                  userBets.flatMap((bet) =>
                    bet.legs
                      .filter((leg) => leg.raceId === nextRace.id)
                      .map((leg) => leg.selectionName),
                  ),
                ),
              }
            })
            .filter((entry) => entry.totalStake > 0 || entry.selections.length > 0)
            .sort((a, b) => b.totalStake - a.totalStake || a.displayName.localeCompare(b.displayName)),
        }

  return {
    race: {
      raceId,
      name: raceSummary.name,
      day: raceSummary.day,
      offTime: raceSummary.offTime,
      status: raceSummary.status,
      lifecycle: raceSummary.lifecycle,
      winner: raceSummary.winner,
      placed: raceSummary.placed,
      marketFavourite: raceSummary.marketFavourite,
      users: raceSummary.users,
    },
    standings,
    nextRace: nextRaceSummary,
  }
}

export function buildGeminiRaceResultNotificationText(
  state: TrackerStateInput,
  raceId: string,
  nowIso = new Date().toISOString(),
): string {
  const summary = buildGeminiRaceResultNotificationSummary(state, raceId, nowIso)
  const lines = [
    "Cheltenham Race Result Context",
    `Settled race: ${summary.race.name}. Winner: ${summary.race.winner ?? "unknown"}.`,
    summary.nextRace
      ? `Next race: ${summary.nextRace.name} at ${summary.nextRace.offTime}.`
      : "Next race: none scheduled.",
    "Tracker JSON:",
    JSON.stringify(summary),
  ]

  return lines.join("\n")
}
