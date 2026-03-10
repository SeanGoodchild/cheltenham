import { describe, expect, it } from "vitest"

import {
  extractSportingLifeNextDataJson,
  isSportingLifeRaceStageFinal,
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

  it("only treats weighed in results as final", () => {
    expect(isSportingLifeRaceStageFinal("WEIGHEDIN")).toBe(true)
    expect(isSportingLifeRaceStageFinal("RESULT")).toBe(false)
    expect(isSportingLifeRaceStageFinal(" weighed-in ")).toBe(true)
    expect(isSportingLifeRaceStageFinal(undefined)).toBe(false)
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
                betting: {
                  current_odds: "33/1",
                },
                bookmakerOdds: [
                  {
                    bookmakerName: "Paddy Power",
                    fractionalOdds: "33/1",
                    decimalOdds: 34,
                    bestOdds: true,
                  },
                ],
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
          finishPosition: undefined,
        },
        {
          horseUid: 222,
          horseName: "Scratched Horse",
          nonRunner: true,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
          finishPosition: undefined,
        },
      ],
      runners: ["Baron Noir"],
      oddsSnapshot: [
        {
          horseUid: 111,
          horseName: "Baron Noir",
          bestFractional: "33/1",
          bestDecimal: 34,
          bestBookmaker: "Paddy Power",
          booksQuoted: 1,
          impliedProbabilityPct: 2.94,
          rank: 1,
          isFavourite: true,
        },
      ],
      marketFavourite: {
        horseUid: 111,
        horseName: "Baron Noir",
        bestFractional: "33/1",
        bestDecimal: 34,
      },
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
                betting: {
                  current_odds: "10/1",
                },
                bookmakerOdds: [
                  {
                    bookmakerName: "Sky Bet",
                    fractionalOdds: "10/1",
                    decimalOdds: 11,
                    bestOdds: false,
                  },
                ],
                horse: { horse_reference: { id: 444 }, name: "Red Hot Kisses" },
              },
              {
                ride_status: "RUNNER",
                finish_position: 1,
                cloth_number: 6,
                betting: {
                  current_odds: "5/2",
                },
                bookmakerOdds: [
                  {
                    bookmakerName: "Paddy Power",
                    fractionalOdds: "5/2",
                    decimalOdds: 3.5,
                    bestOdds: true,
                  },
                ],
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
                betting: {
                  current_odds: "7/2",
                },
                bookmakerOdds: [
                  {
                    bookmakerName: "Betfair Sportsbook",
                    fractionalOdds: "7/2",
                    decimalOdds: 4.5,
                    bestOdds: true,
                  },
                ],
                horse: { horse_reference: { id: 222 }, name: "Whatastar" },
              },
              {
                ride_status: "RUNNER",
                finish_position: 3,
                betting: {
                  current_odds: "8/1",
                },
                bookmakerOdds: [
                  {
                    bookmakerName: "Sky Bet",
                    fractionalOdds: "8/1",
                    decimalOdds: 9,
                    bestOdds: true,
                  },
                ],
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
          finishPosition: 4,
        },
        {
          horseUid: 111,
          horseName: "Magical Sky",
          nonRunner: false,
          jockeyName: "Damyan Pillay",
          trainerName: undefined,
          draw: undefined,
          finishPosition: 1,
        },
        {
          horseUid: 333,
          horseName: "Gorgeous Bomb",
          nonRunner: true,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
          finishPosition: undefined,
        },
        {
          horseUid: 222,
          horseName: "Whatastar",
          nonRunner: false,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
          finishPosition: 2,
        },
        {
          horseUid: 555,
          horseName: "Sun In My Pocket",
          nonRunner: false,
          jockeyName: undefined,
          trainerName: undefined,
          draw: undefined,
          finishPosition: 3,
        },
      ],
      runners: ["Red Hot Kisses", "Magical Sky", "Whatastar", "Sun In My Pocket"],
      oddsSnapshot: [
        {
          horseUid: 111,
          horseName: "Magical Sky",
          bestFractional: "5/2",
          bestDecimal: 3.5,
          bestBookmaker: "Paddy Power",
          booksQuoted: 1,
          impliedProbabilityPct: 28.57,
          rank: 1,
          isFavourite: true,
        },
        {
          horseUid: 222,
          horseName: "Whatastar",
          bestFractional: "7/2",
          bestDecimal: 4.5,
          bestBookmaker: "Betfair Sportsbook",
          booksQuoted: 1,
          impliedProbabilityPct: 22.22,
          rank: 2,
          isFavourite: false,
        },
        {
          horseUid: 555,
          horseName: "Sun In My Pocket",
          bestFractional: "8/1",
          bestDecimal: 9,
          bestBookmaker: "Sky Bet",
          booksQuoted: 1,
          impliedProbabilityPct: 11.11,
          rank: 3,
          isFavourite: false,
        },
        {
          horseUid: 444,
          horseName: "Red Hot Kisses",
          bestFractional: "10/1",
          bestDecimal: 11,
          bestBookmaker: "Sky Bet",
          booksQuoted: 1,
          impliedProbabilityPct: 9.09,
          rank: 4,
          isFavourite: false,
        },
      ],
      marketFavourite: {
        horseUid: 111,
        horseName: "Magical Sky",
        bestFractional: "5/2",
        bestDecimal: 3.5,
      },
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
