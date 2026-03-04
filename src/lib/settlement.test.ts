import { describe, expect, it } from "vitest"

import {
  calculateBetReturn,
  deriveLockAt,
  getDerivedBetStatus,
  isBetSettleable,
} from "@/lib/settlement"
import type { Bet, Race } from "@/lib/types"

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
})
