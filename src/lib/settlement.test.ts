import { describe, expect, it } from "vitest"

import {
  calculateBetPotentialReturn,
  calculateBetReturn,
  computeGlobalStats,
  computeUserStats,
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
})
