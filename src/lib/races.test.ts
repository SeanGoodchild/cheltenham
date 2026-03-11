import { describe, expect, it } from "vitest"

import { getNextRelevantRace, isRaceResultPendingExpired } from "@/lib/races"
import type { Race } from "@/lib/types"

const baseRace = (overrides: Partial<Race>): Race => ({
  id: "race-1",
  season: "2026",
  day: "Wednesday",
  offTime: "2026-03-11T14:40:00.000Z",
  course: "Cheltenham",
  name: "Test Race",
  runners: [],
  status: "scheduled",
  lifecycle: "upcoming",
  result: { winner: undefined, placed: [], source: "manual" },
  ...overrides,
})

describe("race sequencing helpers", () => {
  it("treats stale result-pending races as expired after 20 minutes", () => {
    expect(
      isRaceResultPendingExpired(
        baseRace({ status: "result_pending", offTime: "2026-03-11T14:40:00.000Z" }),
        new Date("2026-03-11T14:59:59.000Z").getTime(),
      ),
    ).toBe(false)

    expect(
      isRaceResultPendingExpired(
        baseRace({ status: "result_pending", offTime: "2026-03-11T14:40:00.000Z" }),
        new Date("2026-03-11T15:00:00.000Z").getTime(),
      ),
    ).toBe(true)
  })

  it("skips stale result-pending races when choosing the next relevant race", () => {
    const stalePending = baseRace({
      id: "r1",
      name: "Wed 14:40",
      status: "result_pending",
      lifecycle: "complete",
      offTime: "2026-03-11T14:40:00.000Z",
    })
    const upcoming = baseRace({
      id: "r2",
      name: "Wed 15:20",
      offTime: "2026-03-11T15:20:00.000Z",
    })

    expect(
      getNextRelevantRace([stalePending, upcoming], new Date("2026-03-11T15:15:00.000Z").getTime())?.id,
    ).toBe("r2")
  })
})
