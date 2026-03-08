import { describe, expect, it } from "vitest"

import {
  extractSportingLifeNextDataJson,
  parseSportingLifeRacePageHtml,
  parseSportingLifeRaceUrl,
} from "@/lib/sportingLife"

function wrapNextData(payload: unknown) {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`
}

describe("sporting life parser", () => {
  it("parses racecard URLs", () => {
    expect(
      parseSportingLifeRaceUrl(
        "https://www.sportinglife.com/racing/racecards/2026-03-10/cheltenham/racecard/899039/wrong-slug",
      ),
    ).toEqual({
      sourceUrl:
        "https://www.sportinglife.com/racing/racecards/2026-03-10/cheltenham/racecard/899039/wrong-slug",
      pageType: "racecards",
      date: "2026-03-10",
      courseSlug: "cheltenham",
      raceId: 899039,
      slug: "wrong-slug",
    })
  })

  it("parses results URLs", () => {
    expect(
      parseSportingLifeRaceUrl(
        "https://www.sportinglife.com/racing/results/2026-03-08/greyville/906791/join-the-race",
      ),
    ).toEqual({
      sourceUrl: "https://www.sportinglife.com/racing/results/2026-03-08/greyville/906791/join-the-race",
      pageType: "results",
      date: "2026-03-08",
      courseSlug: "greyville",
      raceId: 906791,
      slug: "join-the-race",
    })
  })

  it("parses a pre-race Cheltenham page shape", () => {
    const html = wrapNextData({
      props: {
        pageProps: {
          race: {
            race_summary: {
              race_summary_reference: { id: 899039 },
              name: "Sky Bet Supreme Novices' Hurdle (Grade 1) (GBB Race)",
              date: "2026-03-10",
              time: "13:20",
              race_stage: "DORMANT",
            },
            number_of_placed_rides: 3,
            rides: [
              {
                ride_status: "RUNNER",
                finish_position: 0,
                draw_number: 1,
                horse: { horse_reference: { id: 111 }, name: "Baron Noir" },
                jockey: { name: "Thomas Bellamy" },
                trainer: { name: "A King" },
              },
              {
                ride_status: "NONRUNNER",
                finish_position: 0,
                horse: { horse_reference: { id: 222 }, name: "Scratched Horse" },
              },
            ],
          },
        },
      },
    })

    expect(parseSportingLifeRacePageHtml(html)).toEqual({
      externalRaceId: 899039,
      name: "Sky Bet Supreme Novices' Hurdle (Grade 1) (GBB Race)",
      offTime: "2026-03-10T13:20:00.000Z",
      raceStage: "DORMANT",
      runnersDetailed: [
        {
          horseUid: 111,
          horseName: "Baron Noir",
          nonRunner: false,
          jockeyName: "Thomas Bellamy",
          trainerName: "A King",
          draw: 1,
        },
        {
          horseUid: 222,
          horseName: "Scratched Horse",
          nonRunner: true,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
        },
      ],
      runners: ["Baron Noir"],
      result: null,
    })
  })

  it("parses a completed results page shape", () => {
    const html = wrapNextData({
      props: {
        pageProps: {
          race: {
            race_summary: {
              race_summary_reference: { id: 906791 },
              name: "Join The Race Coast Turf Club Today! Class 5 (F & M)",
              date: "2026-03-08",
              time: "12:25",
              race_stage: "WEIGHEDIN",
            },
            number_of_placed_rides: 3,
            rides: [
              {
                ride_status: "RUNNER",
                finish_position: 4,
                horse: { horse_reference: { id: 444 }, name: "Red Hot Kisses" },
              },
              {
                ride_status: "RUNNER",
                finish_position: 1,
                cloth_number: 6,
                horse: { horse_reference: { id: 111 }, name: "Magical Sky" },
                jockey: { name: "Damyan Pillay" },
              },
              {
                ride_status: "NONRUNNER",
                finish_position: 0,
                horse: { horse_reference: { id: 333 }, name: "Gorgeous Bomb" },
              },
              {
                ride_status: "RUNNER",
                finish_position: 2,
                horse: { horse_reference: { id: 222 }, name: "Whatastar" },
              },
              {
                ride_status: "RUNNER",
                finish_position: 3,
                horse: { horse_reference: { id: 555 }, name: "Sun In My Pocket" },
              },
            ],
          },
        },
      },
    })

    expect(parseSportingLifeRacePageHtml(html)).toEqual({
      externalRaceId: 906791,
      name: "Join The Race Coast Turf Club Today! Class 5 (F & M)",
      offTime: "2026-03-08T12:25:00.000Z",
      raceStage: "WEIGHEDIN",
      runnersDetailed: [
        {
          horseUid: 444,
          horseName: "Red Hot Kisses",
          nonRunner: false,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
        },
        {
          horseUid: 111,
          horseName: "Magical Sky",
          nonRunner: false,
          jockeyName: "Damyan Pillay",
          trainerName: undefined,
          draw: undefined,
        },
        {
          horseUid: 333,
          horseName: "Gorgeous Bomb",
          nonRunner: true,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
        },
        {
          horseUid: 222,
          horseName: "Whatastar",
          nonRunner: false,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
        },
        {
          horseUid: 555,
          horseName: "Sun In My Pocket",
          nonRunner: false,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
        },
      ],
      runners: ["Red Hot Kisses", "Magical Sky", "Whatastar", "Sun In My Pocket"],
      result: {
        winner: "Magical Sky",
        placed: ["Magical Sky", "Whatastar", "Sun In My Pocket"],
      },
    })
  })

  it("throws if next data is missing", () => {
    expect(() => extractSportingLifeNextDataJson("<html></html>")).toThrow(/__NEXT_DATA__/)
  })
})
