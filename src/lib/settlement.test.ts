import { describe, expect, it } from "vitest"

import {
  buildRaceOutcomeRanges,
  calculateBetPotentialProfit,
  calculateBetPotentialReturn,
  calculateBetReturn,
  computeGlobalStats,
  computeUserStats,
  deriveLegResult,
  deriveLockAt,
  getDerivedBetStatus,
  isBetSettleable,
  resolveBetOddsUsed,
} from "@/lib/settlement"
import type { Bet, Race, UserProfile } from "@/lib/types"

const races: Race[] = [
  {
    id: "r1",
    season: "2026",
    day: "Tuesday",
    offTime: "2026-03-10T13:30:00.000Z",
    course: "Cheltenham",
    name: "Race 1",
    runners: ["Horse A", "Horse B"],
    status: "scheduled",
    lifecycle: "upcoming",
    result: { winner: undefined, placed: [], source: "manual" },
  },
  {
    id: "r2",
    season: "2026",
    day: "Tuesday",
    offTime: "2026-03-10T14:10:00.000Z",
    course: "Cheltenham",
    name: "Race 2",
    runners: ["Horse C", "Horse D"],
    status: "scheduled",
    lifecycle: "upcoming",
    result: { winner: undefined, placed: [], source: "manual" },
  },
]

function baseBet(overrides: Partial<Bet>): Bet {
  return {
    id: "b1",
    season: "2026",
    userId: "howes",
    betType: "single",
    legs: [
      {
        raceId: "r1",
        selectionName: "Horse A",
        decimalOdds: 2,
        result: "pending",
      },
    ],
    legRaceIds: ["r1"],
    stakeTotal: 10,
    lockAt: "2026-03-10T13:30:00.000Z",
    status: "open",
    createdAt: "2026-03-10T12:00:00.000Z",
    updatedAt: "2026-03-10T12:00:00.000Z",
    ...overrides,
  }
}

describe("settlement rules", () => {
  it("calculates single win returns", () => {
    const bet = baseBet({ legs: [{ ...baseBet({}).legs[0], result: "win" }] })
    expect(calculateBetReturn(bet)).toBe(20)
  })

  it("calculates each-way place return with split stake", () => {
    const bet = baseBet({
      betType: "each_way",
      stakeTotal: 10,
      legs: [{ raceId: "r1", selectionName: "Horse A", decimalOdds: 6, result: "place" }],
      ewTerms: { placesPaid: 3, placeFraction: 0.2 },
    })

    expect(calculateBetReturn(bet)).toBe(10)
  })

  it("treats a runner finishing inside paid each-way places as a place", () => {
    const race: Race = {
      ...races[0],
      runnersDetailed: [
        {
          horseUid: 123,
          horseName: "Horse A",
          nonRunner: false,
          finishPosition: 4,
        },
      ],
      result: { winner: "Horse B", placed: ["Horse B", "Horse C", "Horse D"], source: "manual" },
    }

    expect(
      deriveLegResult("Horse A", race, {
        horseUid: 123,
        betType: "each_way",
        ewTerms: { placesPaid: 4, placeFraction: 0.2 },
      }),
    ).toBe("place")
  })

  it("calculates accumulator return with void leg as 1.0", () => {
    const bet = baseBet({
      betType: "accumulator",
      stakeTotal: 5,
      legs: [
        { raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "win" },
        { raceId: "r2", selectionName: "Horse C", decimalOdds: 3, result: "void" },
      ],
    })

    expect(calculateBetReturn(bet)).toBe(10)
  })

  it("settles accumulator early if a leg loses", () => {
    const bet = baseBet({
      betType: "accumulator",
      legs: [
        { raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "lose" },
        { raceId: "r2", selectionName: "Horse C", decimalOdds: 3, result: "pending" },
      ],
    })

    expect(isBetSettleable(bet)).toBe(true)
    expect(calculateBetReturn(bet)).toBe(0)
  })

  it("treats an accumulator place leg as a dead leg", () => {
    const bet = baseBet({
      betType: "accumulator",
      legs: [
        { raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "place" },
        { raceId: "r2", selectionName: "Horse C", decimalOdds: 3, result: "pending" },
      ],
    })

    expect(isBetSettleable(bet)).toBe(true)
    expect(calculateBetReturn(bet)).toBe(0)
  })

  it("derives accumulator lockAt from earliest race", () => {
    const lockAt = deriveLockAt(
      [
        { raceId: "r2" },
        { raceId: "r1" },
      ],
      races,
    )

    expect(lockAt).toBe("2026-03-10T13:30:00.000Z")
  })

  it("marks bets locked after lock time", () => {
    const bet = baseBet({})
    expect(getDerivedBetStatus(bet, "2026-03-10T13:31:00.000Z")).toBe("locked")
  })

  it("uses final accumulator odds when provided", () => {
    const bet = baseBet({
      betType: "accumulator",
      oddsUsed: 7.5,
      stakeTotal: 4,
      legs: [
        { raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "win" },
        { raceId: "r2", selectionName: "Horse C", decimalOdds: 3, result: "win" },
      ],
    })

    expect(resolveBetOddsUsed(bet)).toBe(7.5)
    expect(calculateBetReturn(bet)).toBe(30)
  })

  it("calculates potential win from odds used", () => {
    const bet = baseBet({
      stakeTotal: 12,
      oddsUsed: 4.2,
      legs: [{ raceId: "r1", selectionName: "Horse A", decimalOdds: 4.2, result: "pending" }],
    })

    expect(calculateBetPotentialReturn(bet)).toBeCloseTo(50.4, 6)
  })

  it("calculates free bet single returns without returning stake", () => {
    const bet = baseBet({
      isFreeBet: true,
      stakeTotal: 2,
      oddsUsed: 2,
      legs: [{ raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "win" }],
    })

    expect(calculateBetReturn(bet)).toBe(2)
    expect(calculateBetPotentialProfit(bet)).toBe(2)
  })
})

describe("stats calculations", () => {
  const user: UserProfile = { id: "howes", displayName: "Howes", isActive: true }

  it("does not count unsettled bets as losses in P&L", () => {
    const settledWin = baseBet({
      status: "settled",
      stakeTotal: 10,
      totalReturn: 25,
      profitLoss: 15,
      legs: [{ raceId: "r1", selectionName: "Horse A", decimalOdds: 2.5, result: "win" }],
    })
    const openBet = baseBet({
      id: "b2",
      status: "open",
      stakeTotal: 20,
      totalReturn: undefined,
      profitLoss: undefined,
      legs: [{ raceId: "r1", selectionName: "Horse B", decimalOdds: 4, result: "pending" }],
    })

    const userStats = computeUserStats(user, [settledWin, openBet])
    expect(userStats.totalStaked).toBe(30)
    expect(userStats.totalReturns).toBe(25)
    expect(userStats.profitLoss).toBe(15)

    const global = computeGlobalStats([settledWin, openBet], [user], "2026-03-10T14:00:00.000Z")
    expect(global.totalStaked).toBe(30)
    expect(global.totalReturns).toBe(25)
    expect(global.roasPct).toBe(250)
  })

  it("does not treat free bet stake as cash risk in settled P&L", () => {
    const freeBetWin = baseBet({
      status: "settled",
      isFreeBet: true,
      stakeTotal: 2,
      totalReturn: 2,
      profitLoss: 2,
      legs: [{ raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "win" }],
    })

    const userStats = computeUserStats(user, [freeBetWin])
    expect(userStats.totalStaked).toBe(0)
    expect(userStats.totalReturns).toBe(2)
    expect(userStats.profitLoss).toBe(2)

    const global = computeGlobalStats([freeBetWin], [user], "2026-03-10T14:00:00.000Z")
    expect(global.totalStaked).toBe(0)
    expect(global.totalReturns).toBe(2)
    expect(global.roasPct).toBe(0)
  })
})

describe("race outcome ranges", () => {
  const settledRace: Race = {
    id: "r1",
    season: "2026",
    day: "Tuesday",
    offTime: "2026-03-10T13:30:00.000Z",
    course: "Cheltenham",
    name: "Supreme",
    runners: ["Horse A", "Horse B", "Horse C"],
    status: "settled",
    lifecycle: "complete",
    result: { winner: "Horse A", placed: ["Horse A", "Horse B", "Horse C"], source: "manual" },
  }

  const nextRace: Race = {
    id: "r2",
    season: "2026",
    day: "Tuesday",
    offTime: "2026-03-10T14:10:00.000Z",
    course: "Cheltenham",
    name: "Arkle",
    runners: ["Horse D", "Horse E", "Horse F", "Horse G"],
    status: "scheduled",
    lifecycle: "upcoming",
    result: { winner: undefined, placed: [], source: "manual" },
  }

  it("builds historical and next-race ranges for singles", () => {
    const settledBet = baseBet({
      id: "b-settled",
      status: "settled",
      totalReturn: 20,
      profitLoss: 10,
      legs: [{ raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "win" }],
    })
    const nextBet = baseBet({
      id: "b-next",
      legs: [{ raceId: "r2", selectionName: "Horse D", decimalOdds: 3, result: "pending" }],
    })

    const ranges = buildRaceOutcomeRanges([settledRace, nextRace], [settledBet, nextBet])

    expect(ranges).toHaveLength(2)
    expect(ranges[0]).toMatchObject({
      raceId: "r1",
      openPnl: 0,
      actualClosePnl: 10,
      bestDelta: 10,
      worstDelta: -10,
      isForecast: false,
    })
    expect(ranges[1]).toMatchObject({
      raceId: "r2",
      openPnl: 10,
      actualClosePnl: undefined,
      bestDelta: 20,
      worstDelta: -10,
      bestClosePnl: 30,
      worstClosePnl: 0,
      isForecast: true,
    })
  })

  it("builds forecast ranges for races beyond the next race", () => {
    const futureRace: Race = {
      ...nextRace,
      id: "r3",
      offTime: "2026-03-10T15:30:00.000Z",
      name: "Future Race",
      runners: ["Horse G", "Horse H"],
      runnersDetailed: [
        { horseName: "Horse G", horseUid: 7, nonRunner: false },
        { horseName: "Horse H", horseUid: 8, nonRunner: false },
      ],
      marketFavourite: {
        horseName: "Horse G",
        horseUid: 7,
        bestFractional: "3/1",
        bestDecimal: 4,
        source: "irishracing",
        importedAt: "2026-03-10T14:00:00.000Z",
      },
    }

    const futureBet = baseBet({
      id: "b-future",
      legs: [{ raceId: "r3", selectionName: "Horse G", decimalOdds: 4, result: "pending" }],
    })

    const ranges = buildRaceOutcomeRanges([settledRace, nextRace, futureRace], [futureBet])

    expect(ranges).toHaveLength(3)
    expect(ranges[2]).toMatchObject({
      raceId: "r3",
      actualClosePnl: undefined,
      bestDelta: 30,
      worstDelta: -10,
      bestClosePnl: 30,
      worstClosePnl: -10,
      isForecast: true,
    })
  })

  it("handles each-way win, place, and lose outcomes", () => {
    const ewBet = baseBet({
      betType: "each_way",
      stakeTotal: 10,
      legs: [{ raceId: "r2", selectionName: "Horse D", decimalOdds: 6, result: "pending" }],
      ewTerms: { placesPaid: 3, placeFraction: 0.2 },
    })

    const ranges = buildRaceOutcomeRanges([settledRace, nextRace], [ewBet])
    const nextRange = ranges.at(-1)

    expect(nextRange).toMatchObject({
      raceId: "r2",
      bestDelta: 30,
      worstDelta: -10,
      bestClosePnl: 30,
      worstClosePnl: -10,
    })
  })

  it("only settles accumulators on the final race and fixes earlier completed legs", () => {
    const winningEarlierLegAcca = baseBet({
      betType: "accumulator",
      stakeTotal: 5,
      legs: [
        { raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "pending" },
        { raceId: "r2", selectionName: "Horse D", decimalOdds: 3, result: "pending" },
      ],
    })

    const losingEarlierLegAcca = baseBet({
      id: "b-loser",
      betType: "accumulator",
      stakeTotal: 5,
      legs: [
        { raceId: "r1", selectionName: "Horse B", decimalOdds: 2, result: "pending" },
        { raceId: "r2", selectionName: "Horse D", decimalOdds: 3, result: "pending" },
      ],
    })

    const ranges = buildRaceOutcomeRanges(
      [settledRace, nextRace],
      [winningEarlierLegAcca, losingEarlierLegAcca],
    )
    const nextRange = ranges.at(-1)

    expect(nextRange).toMatchObject({
      raceId: "r2",
      bestDelta: 20,
      worstDelta: -10,
      bestClosePnl: 20,
      worstClosePnl: -10,
    })
  })

  it("ignores non-race-linked other bets and yields zero-width ranges when needed", () => {
    const otherBet = baseBet({
      betType: "other",
      betName: "Lucky football punt",
      legs: [{ raceId: "__other__", selectionName: "Anything", decimalOdds: 2, result: "pending" }],
    })

    const ranges = buildRaceOutcomeRanges([settledRace, nextRace], [otherBet])

    expect(ranges[0]).toMatchObject({
      raceId: "r1",
      bestDelta: 0,
      worstDelta: 0,
      bestClosePnl: 0,
      worstClosePnl: 0,
    })
    expect(ranges[1]).toMatchObject({
      raceId: "r2",
      bestDelta: 0,
      worstDelta: 0,
    })
  })
})
