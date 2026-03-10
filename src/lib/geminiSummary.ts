import type { Bet, Race, UserProfile } from "./types.js"
import { APP_TIMEZONE } from "./constants.js"
import {
  calculateBetPotentialProfit,
  calculateBetPotentialReturn,
  computeGlobalStats,
  computeUserStats,
  getBetRiskStake,
  getBetSettlementRaceId,
  getDerivedBetStatus,
  resolveBetOddsUsed,
} from "./settlement.js"

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

export type GeminiTrackerFactPacket = {
  packetType: "tracker_state"
  generatedAt: string
  overview: {
    betsPlaced: number
    cashStakedDisplay: string
    settledCashStakedDisplay: string
    settledReturnsDisplay: string
    settledPlDisplay: string
    openRiskDisplay: string
    winPctDisplay: string
    roasPctDisplay: string
    openTootsCount: number
  }
  standings: Array<{
    displayName: string
    overallPlDisplay: string
    cashStakedDisplay: string
    settledReturnsDisplay: string
    openRiskDisplay: string
    winPctDisplay: string
    betsPlaced: number
  }>
  leader: {
    displayName: string
    overallPlDisplay: string
  } | null
  biggestLoser: {
    displayName: string
    overallPlDisplay: string
  } | null
  lastSettledRace: {
    raceId: string
    name: string
    offTimeDisplay: string
    winner: string | null
    placed: string[]
    users: Array<{
      displayName: string
      racePlDisplay: string
      cashStakedDisplay: string
      settledReturnsDisplay: string
      winningSelections: string[]
      placedSelections: string[]
      losingSelections: string[]
    }>
  } | null
  nextRace: {
    raceId: string
    name: string
    offTimeDisplay: string
    status: Race["status"]
    marketFavourite: string | null
    openSelections: Array<{
      displayName: string
      cashStakeDisplay: string
      selections: string[]
    }>
  } | null
  races: Array<{
    raceId: string
    name: string
    offTimeDisplay: string
    status: Race["status"]
    lifecycle: Race["lifecycle"]
    winner: string | null
    placed: string[]
    marketFavourite: string | null
    users: Array<{
      displayName: string
      betsCount: number
      cashStakedDisplay: string
      settledReturnsDisplay: string
      racePlDisplay: string
      winningSelections: string[]
      placedSelections: string[]
      losingSelections: string[]
    }>
  }>
}

export type GeminiRaceResultFactPacket = {
  packetType: "race_result"
  generatedAt: string
  settledRace: {
    raceId: string
    name: string
    day: Race["day"]
    offTimeDisplay: string
    winner: string | null
    placed: string[]
    marketFavourite: string | null
    users: Array<{
      displayName: string
      racePlDisplay: string
      cashStakedDisplay: string
      settledReturnsDisplay: string
      winningSelections: string[]
      placedSelections: string[]
      losingSelections: string[]
    }>
  }
  standings: Array<{
    displayName: string
    overallPlDisplay: string
    cashStakedDisplay: string
    settledReturnsDisplay: string
    openRiskDisplay: string
    winPctDisplay: string
    betsPlaced: number
  }>
  nextRace: {
    raceId: string
    name: string
    offTimeDisplay: string
    status: Race["status"]
    marketFavourite: string | null
    openSelections: Array<{
      displayName: string
      cashStakeDisplay: string
      selections: string[]
    }>
  } | null
}

export type GeminiFactPacket = GeminiTrackerFactPacket | GeminiRaceResultFactPacket

export type GeminiFactValidationResult = {
  ok: boolean
  invalidTokens: string[]
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

function formatPct(value: number): string {
  return `${value}%`
}

function formatRaceTimeDisplay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return "TBC"
  }
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TIMEZONE,
  }).format(date)
}

function isOpenBetStatus(status: Bet["status"]): boolean {
  return status === "open" || status === "locked"
}

function sortRaceUsers<T extends { displayName: string; racePlDisplay?: string }>(
  values: T[],
  extractValue?: (entry: T) => number,
): T[] {
  return [...values].sort((a, b) => {
    const aValue = extractValue ? extractValue(a) : 0
    const bValue = extractValue ? extractValue(b) : 0
    if (aValue !== bValue) {
      return bValue - aValue
    }
    return a.displayName.localeCompare(b.displayName)
  })
}

function buildOpenSelectionsPacket(
  users: UserProfile[],
  openBets: Bet[],
  race: Race | null,
): NonNullable<GeminiTrackerFactPacket["nextRace"]>["openSelections"] {
  if (!race) {
    return []
  }

  return users
    .map((user) => {
      const userBets = openBets.filter(
        (bet) => bet.userId === user.id && bet.legs.some((leg) => leg.raceId === race.id),
      )

      return {
        displayName: user.displayName,
        cashStakeDisplay: formatMoneyGBP(roundMoney(userBets.reduce((acc, bet) => acc + getBetRiskStake(bet), 0))),
        selections: uniqueStrings(
          userBets.flatMap((bet) =>
            bet.legs
              .filter((leg) => leg.raceId === race.id)
              .map((leg) => leg.selectionName),
          ),
        ),
      }
    })
    .filter((entry) => entry.cashStakeDisplay !== formatMoneyGBP(0) || entry.selections.length > 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
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

export function buildGeminiTrackerFactPacket(
  state: TrackerStateInput,
  nowIso = new Date().toISOString(),
): GeminiTrackerFactPacket {
  const summary = buildGeminiTrackerSummary(state, nowIso)
  const usersById = new Map(state.users.map((user) => [user.id, user]))
  const betsWithDerivedStatus = state.bets.map((bet) => ({
    ...bet,
    status: getDerivedBetStatus(bet, nowIso),
  }))
  const openBets = betsWithDerivedStatus.filter((bet) => isOpenBetStatus(bet.status))
  const lastSettledRaceId = summary.overview.lastSettledRace?.raceId ?? null
  const lastSettledRaceSummary = lastSettledRaceId ? summary.races[lastSettledRaceId] : null
  const nextRace =
    summary.overview.nextRace === null
      ? null
      : state.races.find((race) => race.id === summary.overview.nextRace?.raceId) ?? null

  const standings = summary.overview.leader || summary.overview.biggestLoser
    ? state.users
        .map((user) => {
          const stats = computeUserStats(user, betsWithDerivedStatus)
          const userOpenRisk = roundMoney(
            openBets.filter((bet) => bet.userId === user.id).reduce((acc, bet) => acc + getBetRiskStake(bet), 0),
          )
          return {
            displayName: usersById.get(stats.userId)?.displayName ?? stats.userId,
            overallPlDisplay: formatCompactMoney(roundMoney(stats.profitLoss)),
            cashStakedDisplay: formatMoneyGBP(roundMoney(stats.totalStaked)),
            settledReturnsDisplay: formatMoneyGBP(roundMoney(stats.totalReturns)),
            openRiskDisplay: formatMoneyGBP(userOpenRisk),
            winPctDisplay: formatPct(stats.winPct),
            betsPlaced: stats.betsPlaced,
            _profitLoss: roundMoney(stats.profitLoss),
          }
        })
        .sort((a, b) => b._profitLoss - a._profitLoss || a.displayName.localeCompare(b.displayName))
        .map(({ _profitLoss: _unused, ...entry }) => entry)
    : []

  return {
    packetType: "tracker_state",
    generatedAt: nowIso,
    overview: {
      betsPlaced: summary.overview.betsPlaced,
      cashStakedDisplay: formatMoneyGBP(summary.overview.totalStaked),
      settledCashStakedDisplay: formatMoneyGBP(summary.overview.settledStakeTotal),
      settledReturnsDisplay: formatMoneyGBP(summary.overview.totalReturns),
      settledPlDisplay: formatCompactMoney(summary.overview.settledProfitLoss),
      openRiskDisplay: formatMoneyGBP(roundMoney(openBets.reduce((acc, bet) => acc + getBetRiskStake(bet), 0))),
      winPctDisplay: formatPct(summary.overview.winPct),
      roasPctDisplay: formatPct(summary.overview.roasPct),
      openTootsCount: summary.overview.openBetsCount,
    },
    standings,
    leader: summary.overview.leader
      ? {
          displayName: summary.overview.leader.displayName,
          overallPlDisplay: formatCompactMoney(summary.overview.leader.profitLoss),
        }
      : null,
    biggestLoser: summary.overview.biggestLoser
      ? {
          displayName: summary.overview.biggestLoser.displayName,
          overallPlDisplay: formatCompactMoney(summary.overview.biggestLoser.profitLoss),
        }
      : null,
    lastSettledRace:
      lastSettledRaceSummary === null || lastSettledRaceId === null
        ? null
        : {
            raceId: lastSettledRaceId,
            name: lastSettledRaceSummary.name,
            offTimeDisplay: formatRaceTimeDisplay(lastSettledRaceSummary.offTime),
            winner: lastSettledRaceSummary.winner,
            placed: lastSettledRaceSummary.placed,
            users: sortRaceUsers(
              Object.values(lastSettledRaceSummary.users).map((user) => ({
                displayName: user.displayName,
                racePlDisplay: formatCompactMoney(user.profitLoss),
                cashStakedDisplay: formatMoneyGBP(user.riskStake),
                settledReturnsDisplay: formatMoneyGBP(user.settledReturn),
                winningSelections: user.winningSelections,
                placedSelections: user.placedSelections,
                losingSelections: user.losingSelections,
                _profitLoss: user.profitLoss,
              })),
              (entry) => entry._profitLoss,
            ).map(({ _profitLoss: _unused, ...entry }) => entry),
          },
    nextRace:
      nextRace === null
        ? null
        : {
            raceId: nextRace.id,
            name: nextRace.name,
            offTimeDisplay: formatRaceTimeDisplay(nextRace.offTime),
            status: nextRace.status,
            marketFavourite: nextRace.marketFavourite?.horseName ?? null,
            openSelections: buildOpenSelectionsPacket(state.users, openBets, nextRace),
          },
    races: Object.entries(summary.races).map(([raceId, race]) => ({
      raceId,
      name: race.name,
      offTimeDisplay: formatRaceTimeDisplay(race.offTime),
      status: race.status,
      lifecycle: race.lifecycle,
      winner: race.winner,
      placed: race.placed,
      marketFavourite: race.marketFavourite?.horseName ?? null,
      users: sortRaceUsers(
        Object.values(race.users).map((user) => ({
          displayName: user.displayName,
          betsCount: user.betsCount,
          cashStakedDisplay: formatMoneyGBP(user.riskStake),
          settledReturnsDisplay: formatMoneyGBP(user.settledReturn),
          racePlDisplay: formatCompactMoney(user.profitLoss),
          winningSelections: user.winningSelections,
          placedSelections: user.placedSelections,
          losingSelections: user.losingSelections,
          _profitLoss: user.profitLoss,
        })),
        (entry) => entry._profitLoss,
      ).map(({ _profitLoss: _unused, ...entry }) => entry),
    })),
  }
}

export function buildGeminiTrackerFactPacketText(
  state: TrackerStateInput,
  nowIso = new Date().toISOString(),
): string {
  return [
    "TELEGRAM TRACKER FACT PACKET",
    "Use only values present in this packet. Copy money, percent, and time strings verbatim.",
    JSON.stringify(buildGeminiTrackerFactPacket(state, nowIso), null, 2),
  ].join("\n")
}

export function buildGeminiTrackerSummaryText(
  state: TrackerStateInput,
  nowIso = new Date().toISOString(),
): string {
  return buildGeminiTrackerFactPacketText(state, nowIso)
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
        openBets.filter((bet) => bet.userId === stat.userId).reduce((acc, bet) => acc + getBetRiskStake(bet), 0),
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
                totalStake: roundMoney(userBets.reduce((acc, bet) => acc + getBetRiskStake(bet), 0)),
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

export function buildGeminiRaceResultFactPacket(
  state: TrackerStateInput,
  raceId: string,
  nowIso = new Date().toISOString(),
): GeminiRaceResultFactPacket {
  const summary = buildGeminiRaceResultNotificationSummary(state, raceId, nowIso)

  return {
    packetType: "race_result",
    generatedAt: nowIso,
    settledRace: {
      raceId: summary.race.raceId,
      name: summary.race.name,
      day: summary.race.day,
      offTimeDisplay: formatRaceTimeDisplay(summary.race.offTime),
      winner: summary.race.winner,
      placed: summary.race.placed,
      marketFavourite: summary.race.marketFavourite?.horseName ?? null,
      users: sortRaceUsers(
        Object.values(summary.race.users).map((user) => ({
          displayName: user.displayName,
          racePlDisplay: formatCompactMoney(user.profitLoss),
          cashStakedDisplay: formatMoneyGBP(user.riskStake),
          settledReturnsDisplay: formatMoneyGBP(user.settledReturn),
          winningSelections: user.winningSelections,
          placedSelections: user.placedSelections,
          losingSelections: user.losingSelections,
          _profitLoss: user.profitLoss,
        })),
        (entry) => entry._profitLoss,
      ).map(({ _profitLoss: _unused, ...entry }) => entry),
    },
    standings: summary.standings.map((entry) => ({
      displayName: entry.displayName,
      overallPlDisplay: formatCompactMoney(entry.profitLoss),
      cashStakedDisplay: formatMoneyGBP(entry.totalStaked),
      settledReturnsDisplay: formatMoneyGBP(entry.totalReturns),
      openRiskDisplay: formatMoneyGBP(entry.openStake),
      winPctDisplay: formatPct(entry.winPct),
      betsPlaced: entry.betsPlaced,
    })),
    nextRace:
      summary.nextRace === null
        ? null
        : {
            raceId: summary.nextRace.raceId,
            name: summary.nextRace.name,
            offTimeDisplay: formatRaceTimeDisplay(summary.nextRace.offTime),
            status: summary.nextRace.status,
            marketFavourite: summary.nextRace.marketFavourite?.horseName ?? null,
            openSelections: summary.nextRace.openSelections.map((entry) => ({
              displayName: entry.displayName,
              cashStakeDisplay: formatMoneyGBP(entry.totalStake),
              selections: entry.selections,
            })),
          },
  }
}

export function buildGeminiRaceResultFactPacketText(
  state: TrackerStateInput,
  raceId: string,
  nowIso = new Date().toISOString(),
): string {
  return [
    "TELEGRAM RACE RESULT FACT PACKET",
    "Use only values present in this packet. Copy money, percent, and time strings verbatim.",
    JSON.stringify(buildGeminiRaceResultFactPacket(state, raceId, nowIso), null, 2),
  ].join("\n")
}

export function buildGeminiRaceResultNotificationText(
  state: TrackerStateInput,
  raceId: string,
  nowIso = new Date().toISOString(),
): string {
  return buildGeminiRaceResultFactPacketText(state, raceId, nowIso)
}

const EXTERNAL_INFO_QUERY_REGEX =
  /\b(tip|tips|source|sources|link|links|look up|lookup|search|web|website|racing post|oddschecker|price|prices|market move|market moves|latest news|latest odds)\b/i

export function shouldEnableTelegramFactSearch(prompt: string): boolean {
  return EXTERNAL_INFO_QUERY_REGEX.test(prompt)
}

const FACT_TOKEN_REGEX =
  /[+-]?£\d[\d,]*\.\d{2}|[+-]?\d+(?:\.\d+)?%|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s\d{2}:\d{2}\b|\b\d{2}:\d{2}\b/g

function collectFactDisplayTokens(value: unknown, allowed = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const matches = value.match(FACT_TOKEN_REGEX) ?? []
    matches.forEach((match) => allowed.add(match))
    return allowed
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectFactDisplayTokens(entry, allowed))
    return allowed
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectFactDisplayTokens(entry, allowed))
  }

  return allowed
}

export function validateTelegramReplyAgainstFactPacket(
  reply: string,
  packet: GeminiFactPacket,
): GeminiFactValidationResult {
  const allowedTokens = collectFactDisplayTokens(packet)
  const invalidTokens = uniqueStrings((reply.match(FACT_TOKEN_REGEX) ?? []).filter((token) => !allowedTokens.has(token)))
  return {
    ok: invalidTokens.length === 0,
    invalidTokens,
  }
}
