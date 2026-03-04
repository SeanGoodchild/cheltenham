export type BetType = "single" | "each_way" | "accumulator" | "other"
export type BetStatus = "open" | "locked" | "settled" | "void"
export type RaceStatus = "scheduled" | "off" | "result_pending" | "settled"
export type RaceLifecycle = "upcoming" | "in_progress" | "complete"

export type LegResult = "win" | "place" | "lose" | "void" | "pending"

export type BetLeg = {
  raceId: string
  selectionName: string
  decimalOdds: number
  horseUid?: number
  result: LegResult
}

export type EwTerms = {
  placesPaid: number
  placeFraction: number
}

export type Bet = {
  id: string
  season: string
  userId: string
  betType: BetType
  betName?: string
  oddsUsed?: number
  legs: BetLeg[]
  legRaceIds: string[]
  stakeTotal: number
  ewTerms?: EwTerms
  lockAt: string
  status: BetStatus
  createdAt: string
  updatedAt: string
  settledAt?: string
  totalReturn?: number
  profitLoss?: number
}

export type RaceResult = {
  winner?: string
  placed: string[]
  source: "api" | "scrape" | "manual"
  sourceRef?: string
  updatedAt?: string
}

export type RaceDay = "Tuesday" | "Wednesday" | "Thursday" | "Friday"

export type Race = {
  id: string
  season: string
  day: RaceDay
  offTime: string
  course: "Cheltenham"
  name: string
  externalRaceId?: number
  source?: "cloudfront" | "manual"
  importMeta?: {
    etag?: string
    importedAt: string
    sourceUrl: string
    runId: string
  }
  oddsMeta?: {
    source: "irishracing"
    importedAt: string
    sourceUrl: string
    runId: string
    marketType: "antepost"
  }
  importLock?: {
    lockedByManualOverride: boolean
    reason?: string
    lockedAt?: string
  }
  runnersDetailed?: Array<{
    horseUid?: number
    horseName: string
    nonRunner: boolean
    jockeyName?: string
    trainerName?: string
    draw?: number
  }>
  oddsSnapshot?: Array<{
    horseName: string
    horseUid?: number
    bestFractional: string
    bestDecimal: number
    bestBookmaker?: string
    booksQuoted: number
    impliedProbabilityPct: number
    rank: number
    isFavourite: boolean
  }>
  marketFavourite?: {
    horseName: string
    horseUid?: number
    bestFractional: string
    bestDecimal: number
    source: "irishracing"
    importedAt: string
  }
  runners: string[]
  status: RaceStatus
  lifecycle: RaceLifecycle
  result: RaceResult
}

export type RaceImportRun = {
  id: string
  status: "running" | "completed" | "noop" | "failed" | "busy"
  startedAt: string
  completedAt?: string
  sourceEtag?: string
  summary?: {
    racesInserted: number
    racesUpdated: number
    racesSkippedLocked: number
    runnersChanged: number
    nonRunnersDetected: number
    legsAutoVoided: number
    racesAutoSettled: number
    oddsRacesAttempted: number
    oddsRacesUpdated: number
    oddsRacesFailed: number
    oddsRowsParsed: number
  }
  warnings: string[]
  errors: string[]
}

export type UserProfile = {
  id: string
  displayName: string
  isActive: boolean
}

export type UserStats = {
  userId: string
  totalStaked: number
  totalReturns: number
  profitLoss: number
  roasPct: number
  winPct: number
  betsPlaced: number
  averageOdds: number
  biggestLoss: number
  biggestWin: number
  averageStake: number
}

export type GlobalStats = {
  totalStaked: number
  totalReturns: number
  averageStake: number
  averageOdds: number
  roasPct: number
  winPct: number
  betsPlaced: number
  biggestLoss: number
  biggestWin: number
  biggestWinUserId?: string
  updatedAt: string
}

export type NotificationEventType = "race_result_settled" | "daily_summary"

export type NotificationLog = {
  id: string
  eventType: NotificationEventType
  payload: Record<string, unknown>
  status: "pending" | "sent" | "failed"
  error?: string
  retries: number
  createdAt: string
  updatedAt: string
}
