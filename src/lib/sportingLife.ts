import type { Race } from "./types.js"

export type SportingLifePageType = "racecards" | "results"

export type SportingLifeRaceUrl = {
  sourceUrl: string
  date: string
  courseSlug: string
  raceId: number
  slug: string
  pageType: SportingLifePageType
}

export type ParsedSportingLifeRace = {
  externalRaceId: number
  name: string
  offTime: string
  raceStage: string
  runnersDetailed: NonNullable<Race["runnersDetailed"]>
  runners: string[]
  oddsSnapshot: NonNullable<Race["oddsSnapshot"]>
  marketFavourite?: Pick<NonNullable<Race["marketFavourite"]>, "horseName" | "horseUid" | "bestFractional" | "bestDecimal">
  result: Pick<Race["result"], "winner" | "placed"> | null
}

type SportingLifeRaceSummary = {
  race_summary_reference?: {
    id?: number
  }
  name?: string
  date?: string
  time?: string
  race_stage?: string
}

type SportingLifeRide = {
  ride_status?: string
  finish_position?: number
  draw_number?: number
  betting?: {
    current_odds?: string
  }
  bookmakerOdds?: Array<{
    bookmakerName?: string
    fractionalOdds?: string
    decimalOdds?: number
    bestOdds?: boolean
  }>
  horse?: {
    horse_reference?: {
      id?: number
    }
    name?: string
  }
  jockey?: {
    name?: string
  }
  trainer?: {
    name?: string
  }
}

type SportingLifeRacePayload = {
  race_summary?: SportingLifeRaceSummary
  rides?: SportingLifeRide[]
  number_of_placed_rides?: number
}

export function normalizeSportingLifeRaceStage(value: string | undefined): string {
  return String(value ?? "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase()
}

export function isSportingLifeRaceStageFinal(value: string | undefined): boolean {
  return normalizeSportingLifeRaceStage(value) === "WEIGHEDIN"
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function parseFractionalOdds(value: string | undefined): { fractional: string; decimal: number } | null {
  const compact = String(value ?? "").replace(/\s+/g, "")
  const match = compact.match(/^(\d+)\/(\d+)$/)
  if (!match) {
    return null
  }

  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null
  }

  return {
    fractional: `${numerator}/${denominator}`,
    decimal: roundTo(1 + numerator / denominator, 4),
  }
}

function normalizeHorseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function formatHorseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function normalizeRideStatus(value: string | undefined): string {
  return String(value ?? "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase()
}

function isNonRunnerStatus(value: string | undefined): boolean {
  return normalizeRideStatus(value) === "NONRUNNER"
}

function parseOffTimeIso(date: string, time: string): string {
  const normalizedDate = date.trim()
  const normalizedTime = time.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !/^\d{2}:\d{2}(:\d{2})?$/.test(normalizedTime)) {
    throw new Error(`Invalid Sporting Life date/time: ${date} ${time}`)
  }

  const hhmmss = normalizedTime.length === 5 ? `${normalizedTime}:00` : normalizedTime
  return new Date(`${normalizedDate}T${hhmmss}.000Z`).toISOString()
}

function extractSportingLifeRacePayload(nextData: unknown): SportingLifeRacePayload {
  const root = nextData as {
    props?: {
      pageProps?: {
        race?: SportingLifeRacePayload
      }
    }
  }

  const race = root?.props?.pageProps?.race
  if (!race || typeof race !== "object") {
    throw new Error("Sporting Life next data is missing props.pageProps.race")
  }
  return race
}

export function parseSportingLifeRaceUrl(url: string): SportingLifeRaceUrl {
  const match = url.match(
    /^https:\/\/www\.sportinglife\.com\/racing\/(racecards|results)\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/(?:racecard\/)?(\d+)\/([^/?#]+)\/?$/i,
  )
  if (!match) {
    throw new Error(`Unsupported Sporting Life URL: ${url}`)
  }

  return {
    sourceUrl: url,
    pageType: match[1].toLowerCase() as SportingLifePageType,
    date: match[2],
    courseSlug: match[3],
    raceId: Number(match[4]),
    slug: match[5],
  }
}

export function extractSportingLifeNextDataJson(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) {
    throw new Error("Sporting Life page is missing __NEXT_DATA__")
  }
  return JSON.parse(match[1]) as unknown
}

export function parseSportingLifeRaceFromNextData(nextData: unknown): ParsedSportingLifeRace {
  const race = extractSportingLifeRacePayload(nextData)
  const summary = race.race_summary
  const externalRaceId = Number(summary?.race_summary_reference?.id)
  const name = String(summary?.name ?? "").trim()
  const date = String(summary?.date ?? "").trim()
  const time = String(summary?.time ?? "").trim()

  if (!Number.isFinite(externalRaceId) || !name || !date || !time) {
    throw new Error("Sporting Life race payload is missing summary fields")
  }

  const runnersDetailed = (Array.isArray(race.rides) ? race.rides : [])
    .map((ride) => {
      const horseName = String(ride.horse?.name ?? "").trim()
      if (!horseName) {
        return null
      }
      const horseUid = Number(ride.horse?.horse_reference?.id)
      return {
        horseUid: Number.isFinite(horseUid) ? horseUid : undefined,
        horseName: formatHorseName(horseName),
        nonRunner: isNonRunnerStatus(ride.ride_status),
        jockeyName: typeof ride.jockey?.name === "string" ? ride.jockey.name : undefined,
        trainerName: typeof ride.trainer?.name === "string" ? ride.trainer.name : undefined,
        draw: Number.isFinite(Number(ride.draw_number)) ? Number(ride.draw_number) : undefined,
        finishPosition: Number.isFinite(Number(ride.finish_position)) ? Number(ride.finish_position) : 0,
      }
    })
    .filter((ride): ride is NonNullable<typeof ride> => Boolean(ride))

  const runners = runnersDetailed.filter((ride) => !ride.nonRunner).map((ride) => ride.horseName)
  const placedLimit = Number(race.number_of_placed_rides ?? 0)
  const ranked = runnersDetailed
    .filter((ride) => !ride.nonRunner && ride.finishPosition > 0)
    .sort((a, b) => a.finishPosition - b.finishPosition)

  const winner = ranked.find((ride) => ride.finishPosition === 1)?.horseName
  const placed = ranked
    .filter((ride) => ride.finishPosition <= placedLimit)
    .map((ride) => ride.horseName)
    .filter((horseName, index, values) => {
      const normalized = normalizeHorseName(horseName)
      return values.findIndex((entry) => normalizeHorseName(entry) === normalized) === index
    })

  const normalizedRunnersDetailed: NonNullable<Race["runnersDetailed"]> = runnersDetailed.map((ride) => ({
    horseUid: ride.horseUid,
    horseName: ride.horseName,
    nonRunner: ride.nonRunner,
    jockeyName: ride.jockeyName,
    trainerName: ride.trainerName,
    draw: ride.draw,
    finishPosition: ride.finishPosition > 0 ? ride.finishPosition : undefined,
  }))

  const oddsSnapshot = (Array.isArray(race.rides) ? race.rides : [])
    .map((ride) => {
      const horseNameRaw = String(ride.horse?.name ?? "").trim()
      if (!horseNameRaw || isNonRunnerStatus(ride.ride_status)) {
        return null
      }

      const matchedRunner = normalizedRunnersDetailed.find(
        (runner) => normalizeHorseName(runner.horseName) === normalizeHorseName(horseNameRaw),
      )
      const bookmakerOdds = Array.isArray(ride.bookmakerOdds) ? ride.bookmakerOdds : []
      const parsedBookmakerOdds = bookmakerOdds
        .map((entry) => {
          const fractional = typeof entry.fractionalOdds === "string" ? entry.fractionalOdds.trim() : ""
          const decimal = Number(entry.decimalOdds)
          const parsedFractional = parseFractionalOdds(fractional)
          if (!fractional || !Number.isFinite(decimal) || decimal < 1) {
            return null
          }
          return {
            bookmakerName: typeof entry.bookmakerName === "string" ? entry.bookmakerName : undefined,
            fractionalOdds: fractional,
            decimalOdds: decimal,
            bestOdds: Boolean(entry.bestOdds),
            parsedFractional,
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

      const bestBookmakerOdds =
        [...parsedBookmakerOdds].sort((a, b) => {
          if (a.decimalOdds !== b.decimalOdds) {
            return b.decimalOdds - a.decimalOdds
          }
          if (a.bestOdds !== b.bestOdds) {
            return Number(b.bestOdds) - Number(a.bestOdds)
          }
          return (a.bookmakerName ?? "").localeCompare(b.bookmakerName ?? "")
        })[0] ?? null

      const fallbackCurrentOdds = parseFractionalOdds(ride.betting?.current_odds)
      const bestFractional = bestBookmakerOdds?.fractionalOdds ?? fallbackCurrentOdds?.fractional ?? null
      const bestDecimal = bestBookmakerOdds?.decimalOdds ?? fallbackCurrentOdds?.decimal ?? null

      if (!matchedRunner || !bestFractional || !bestDecimal) {
        return null
      }

      return {
        horseName: matchedRunner.horseName,
        horseUid: matchedRunner.horseUid,
        bestFractional,
        bestDecimal,
        bestBookmaker: bestBookmakerOdds?.bookmakerName,
        booksQuoted: parsedBookmakerOdds.length,
        impliedProbabilityPct: roundTo((1 / bestDecimal) * 100, 2),
        rank: 0,
        isFavourite: false,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => {
      if (a.bestDecimal !== b.bestDecimal) {
        return a.bestDecimal - b.bestDecimal
      }
      return a.horseName.localeCompare(b.horseName)
    })

  if (oddsSnapshot.length > 0) {
    const favouriteDecimal = oddsSnapshot[0].bestDecimal
    let currentRank = 1

    oddsSnapshot.forEach((entry, index) => {
      if (index > 0 && entry.bestDecimal > oddsSnapshot[index - 1].bestDecimal) {
        currentRank = index + 1
      }

      entry.rank = currentRank
      entry.isFavourite = entry.bestDecimal === favouriteDecimal
    })
  }

  return {
    externalRaceId,
    name,
    offTime: parseOffTimeIso(date, time),
    raceStage: String(summary?.race_stage ?? ""),
    runnersDetailed: normalizedRunnersDetailed,
    runners,
    oddsSnapshot,
    marketFavourite:
      oddsSnapshot[0] === undefined
        ? undefined
        : {
            horseName: oddsSnapshot[0].horseName,
            horseUid: oddsSnapshot[0].horseUid,
            bestFractional: oddsSnapshot[0].bestFractional,
            bestDecimal: oddsSnapshot[0].bestDecimal,
          },
    result: winner && placed.length > 0 ? { winner, placed } : null,
  }
}

export function parseSportingLifeRacePageHtml(html: string): ParsedSportingLifeRace {
  return parseSportingLifeRaceFromNextData(extractSportingLifeNextDataJson(html))
}
