import { describe, expect, it } from "vitest"

import {
  buildGeminiRaceResultFactPacket,
  buildGeminiRaceResultFactPacketText,
  buildGeminiRaceResultNotificationSummary,
  buildGeminiRaceResultNotificationText,
  buildGeminiTrackerFactPacket,
  buildGeminiTrackerFactPacketText,
  buildGeminiTrackerSummary,
  buildGeminiTrackerSummaryText,
  shouldEnableTelegramFactSearch,
  validateTelegramReplyAgainstFactPacket,
} from "@/lib/geminiSummary"
import type { Bet, Race, UserProfile } from "@/lib/types"

const users: UserProfile[] = [
  { id: "howes", displayName: "Howes", isActive: true },
  { id: "fabs", displayName: "Fabs", isActive: true },
]

const races: Race[] = [
  {
    id: "r1",
    season: "2026",
    day: "Tuesday",
    offTime: "2026-03-10T13:30:00.000Z",
    course: "Cheltenham",
    name: "Supreme",
    runners: ["Horse A", "Horse B", "Horse C"],
    status: "settled",
    lifecycle: "complete",
    result: { winner: "Horse A", placed: ["Horse A", "Horse B"], source: "manual" },
    marketFavourite: {
      horseName: "Horse A",
      bestFractional: "2/1",
      bestDecimal: 3,
      source: "irishracing",
      importedAt: "2026-03-10T12:00:00.000Z",
    },
  },
  {
    id: "r2",
    season: "2026",
    day: "Tuesday",
    offTime: "2026-03-10T14:10:00.000Z",
    course: "Cheltenham",
    name: "Arkle",
    runners: ["Horse D", "Horse E", "Horse F"],
    status: "settled",
    lifecycle: "complete",
    result: { winner: "Horse D", placed: ["Horse D", "Horse E"], source: "manual" },
  },
  {
    id: "r3",
    season: "2026",
    day: "Tuesday",
    offTime: "2026-03-10T15:00:00.000Z",
    course: "Cheltenham",
    name: "Ultima",
    runners: ["Horse X", "Horse Y"],
    status: "scheduled",
    lifecycle: "upcoming",
    result: { winner: undefined, placed: [], source: "manual" },
  },
  {
    id: "r4",
    season: "2026",
    day: "Tuesday",
    offTime: "2026-03-10T16:00:00.000Z",
    course: "Cheltenham",
    name: "Champion Hurdle",
    runners: ["Horse G", "Horse H"],
    status: "scheduled",
    lifecycle: "upcoming",
    result: { winner: undefined, placed: [], source: "manual" },
  },
]

const bets: Bet[] = [
  {
    id: "b1",
    season: "2026",
    userId: "howes",
    betType: "single",
    legs: [{ raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "win" }],
    legRaceIds: ["r1"],
    stakeTotal: 10,
    lockAt: "2026-03-10T13:30:00.000Z",
    status: "settled",
    createdAt: "2026-03-10T12:00:00.000Z",
    updatedAt: "2026-03-10T12:00:00.000Z",
    settledAt: "2026-03-10T13:35:00.000Z",
    totalReturn: 20,
    profitLoss: 10,
  },
  {
    id: "b2",
    season: "2026",
    userId: "fabs",
    betType: "each_way",
    legs: [{ raceId: "r2", selectionName: "Horse E", decimalOdds: 6, result: "place" }],
    legRaceIds: ["r2"],
    stakeTotal: 10,
    ewTerms: { placesPaid: 2, placeFraction: 0.2 },
    lockAt: "2026-03-10T14:10:00.000Z",
    status: "settled",
    createdAt: "2026-03-10T12:10:00.000Z",
    updatedAt: "2026-03-10T12:10:00.000Z",
    settledAt: "2026-03-10T14:15:00.000Z",
    totalReturn: 10,
    profitLoss: 0,
  },
  {
    id: "b3",
    season: "2026",
    userId: "howes",
    betType: "accumulator",
    betName: "Double",
    oddsUsed: 6,
    legs: [
      { raceId: "r1", selectionName: "Horse A", decimalOdds: 2, result: "win" },
      { raceId: "r2", selectionName: "Horse D", decimalOdds: 3, result: "win" },
    ],
    legRaceIds: ["r1", "r2"],
    stakeTotal: 5,
    lockAt: "2026-03-10T13:30:00.000Z",
    status: "settled",
    createdAt: "2026-03-10T12:20:00.000Z",
    updatedAt: "2026-03-10T12:20:00.000Z",
    settledAt: "2026-03-10T14:15:00.000Z",
    totalReturn: 30,
    profitLoss: 25,
  },
  {
    id: "b4",
    season: "2026",
    userId: "fabs",
    betType: "single",
    legs: [{ raceId: "r3", selectionName: "Horse X", decimalOdds: 4, result: "pending" }],
    legRaceIds: ["r3"],
    stakeTotal: 2,
    isFreeBet: true,
    lockAt: "2026-03-10T15:00:00.000Z",
    status: "open",
    createdAt: "2026-03-10T12:30:00.000Z",
    updatedAt: "2026-03-10T12:30:00.000Z",
  },
]

describe("gemini tracker summary", () => {
  it("groups bets by race then user and excludes untouched future races", () => {
    const summary = buildGeminiTrackerSummary(
      { users, races, bets },
      "2026-03-10T14:30:00.000Z",
    )

    expect(Object.keys(summary.races)).toEqual(["r1", "r2", "r3"])
    expect(summary.races.r4).toBeUndefined()
    expect(summary.races.r1.users.howes.bets.map((bet) => bet.betId)).toEqual(["b1", "b3"])
    expect(summary.races.r2.users.fabs.bets.map((bet) => bet.betId)).toEqual(["b2"])
    expect(summary.races.r3.users.fabs.bets.map((bet) => bet.betId)).toEqual(["b4"])
  })

  it("includes race result context and per-user payout summaries for the last settled race", () => {
    const summary = buildGeminiTrackerSummary(
      { users, races, bets },
      "2026-03-10T14:30:00.000Z",
    )

    expect(summary.overview.lastSettledRace).toEqual({
      raceId: "r2",
      name: "Arkle",
      offTime: "2026-03-10T14:10:00.000Z",
      winner: "Horse D",
    })
    expect(summary.races.r2.winner).toBe("Horse D")
    expect(summary.races.r2.placed).toEqual(["Horse D", "Horse E"])
    expect(summary.races.r2.users.howes.profitLoss).toBe(25)
    expect(summary.races.r2.users.howes.winningSelections).toEqual(["Horse D"])
    expect(summary.races.r2.users.fabs.placedSelections).toEqual(["Horse E"])
    expect(summary.races.r2.users.fabs.settledReturn).toBe(10)
  })

  it("preserves free-bet and each-way derived fields and uses null for missing race data", () => {
    const summary = buildGeminiTrackerSummary(
      { users, races, bets },
      "2026-03-10T14:30:00.000Z",
    )

    const freeBet = summary.races.r3.users.fabs.bets[0]
    const eachWay = summary.races.r2.users.fabs.bets[0]

    expect(freeBet.riskStake).toBe(0)
    expect(freeBet.potentialLoss).toBe(0)
    expect(freeBet.potentialProfit).toBe(6)
    expect(freeBet.potentialWin).toBe(6)
    expect(freeBet.profitLoss).toBeNull()
    expect(summary.races.r3.winner).toBeNull()
    expect(summary.races.r3.placed).toEqual([])
    expect(summary.races.r3.marketFavourite).toBeNull()

    expect(eachWay.settledReturn).toBe(10)
    expect(eachWay.profitLoss).toBe(0)
    expect(eachWay.loss).toBe(0)
  })

  it("duplicates accumulators in each touched race with a stable settlement race id", () => {
    const summary = buildGeminiTrackerSummary(
      { users, races, bets },
      "2026-03-10T14:30:00.000Z",
    )

    const raceOneAcca = summary.races.r1.users.howes.bets.find((bet) => bet.betId === "b3")
    const raceTwoAcca = summary.races.r2.users.howes.bets.find((bet) => bet.betId === "b3")

    expect(raceOneAcca?.settlementRaceId).toBe("r2")
    expect(raceTwoAcca?.settlementRaceId).toBe("r2")
    expect(raceOneAcca?.legs).toHaveLength(2)
    expect(raceTwoAcca?.legs).toHaveLength(2)
  })

  it("builds a tracker fact packet with cash-risk displays and stable standings", () => {
    const packet = buildGeminiTrackerFactPacket(
      { users, races, bets },
      "2026-03-10T14:30:00.000Z",
    )

    expect(packet.overview.cashStakedDisplay).toBe("£25.00")
    expect(packet.overview.openRiskDisplay).toBe("£0.00")
    expect(packet.standings.map((entry) => entry.displayName)).toEqual(["Howes", "Fabs"])
    expect(packet.standings[0]).toMatchObject({
      displayName: "Howes",
      overallPlDisplay: "+£35.00",
      cashStakedDisplay: "£15.00",
    })
    expect(packet.races.find((race) => race.raceId === "r3")?.users[0]).toMatchObject({
      displayName: "Fabs",
      cashStakedDisplay: "£0.00",
      racePlDisplay: "£0.00",
    })
  })

  it("formats tracker fact packet text with parsable packet json", () => {
    const text = buildGeminiTrackerFactPacketText(
      { users, races, bets },
      "2026-03-10T14:30:00.000Z",
    )

    expect(text).toContain("TELEGRAM TRACKER FACT PACKET")

    const jsonText = text.split("\n").slice(2).join("\n")
    expect(JSON.parse(jsonText)).toMatchObject({
      overview: {
        cashStakedDisplay: "£25.00",
      },
      lastSettledRace: {
        raceId: "r2",
      },
    })
  })

  it("keeps legacy tracker summary text wired to the fact packet format", () => {
    const text = buildGeminiTrackerSummaryText(
      { users, races, bets },
      "2026-03-10T14:30:00.000Z",
    )

    expect(text).toContain("TELEGRAM TRACKER FACT PACKET")
  })

  it("builds race-result fact packet with race swings separate from overall standings", () => {
    const packet = buildGeminiRaceResultFactPacket(
      { users, races, bets },
      "r2",
      "2026-03-10T14:30:00.000Z",
    )

    expect(packet.settledRace.users[0]).toMatchObject({
      displayName: "Howes",
      racePlDisplay: "+£25.00",
    })
    expect(packet.standings[0]).toMatchObject({
      displayName: "Howes",
      overallPlDisplay: "+£35.00",
    })
    expect(packet.nextRace).toMatchObject({
      raceId: "r3",
      openSelections: [
        {
          displayName: "Fabs",
          cashStakeDisplay: "£0.00",
          selections: ["Horse X"],
        },
      ],
    })
  })

  it("formats race-result fact packet text with parsable packet json", () => {
    const text = buildGeminiRaceResultFactPacketText(
      { users, races, bets },
      "r2",
      "2026-03-10T14:30:00.000Z",
    )

    expect(text).toContain("TELEGRAM RACE RESULT FACT PACKET")

    const jsonText = text.split("\n").slice(2).join("\n")
    expect(JSON.parse(jsonText)).toMatchObject({
      settledRace: {
        raceId: "r2",
        winner: "Horse D",
      },
    })
  })

  it("builds race-result notification context with standings and next-race selections", () => {
    const summary = buildGeminiRaceResultNotificationSummary(
      { users, races, bets },
      "r2",
      "2026-03-10T14:30:00.000Z",
    )

    expect(summary.race.raceId).toBe("r2")
    expect(summary.race.users.howes.profitLoss).toBe(25)
    expect(summary.standings[0]).toMatchObject({
      userId: "howes",
      profitLoss: 35,
    })
    expect(summary.nextRace).toMatchObject({
      raceId: "r3",
      openSelections: [
        {
          userId: "fabs",
          totalStake: 0,
          selections: ["Horse X"],
        },
      ],
    })
  })

  it("keeps legacy race-result text wired to the fact packet format", () => {
    const text = buildGeminiRaceResultNotificationText(
      { users, races, bets },
      "r2",
      "2026-03-10T14:30:00.000Z",
    )

    expect(text).toContain("TELEGRAM RACE RESULT FACT PACKET")
  })

  it("enables search only for explicit external info requests", () => {
    expect(shouldEnableTelegramFactSearch("How are things going?")).toBe(false)
    expect(shouldEnableTelegramFactSearch("Give me a tip for the next race")).toBe(true)
    expect(shouldEnableTelegramFactSearch("Can you look up a source for that?")).toBe(true)
  })

  it("flags replies that contain figures missing from the fact packet", () => {
    const packet = buildGeminiTrackerFactPacket(
      { users, races, bets },
      "2026-03-10T14:30:00.000Z",
    )

    expect(
      validateTelegramReplyAgainstFactPacket(
        "Howes leads on +£35.00 and the next race is Tue 15:00.",
        packet,
      ),
    ).toEqual({ ok: true, invalidTokens: [] })

    expect(
      validateTelegramReplyAgainstFactPacket(
        "Howes leads on +£36.00 and the next race is Tue 15:00.",
        packet,
      ),
    ).toEqual({ ok: false, invalidTokens: ["+£36.00"] })
  })
})
