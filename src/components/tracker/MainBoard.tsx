import { useMemo, useState } from "react"
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Clock, Flag, Minus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatMarketOdds, formatPercent } from "@/lib/format"
import { normalizeHorseName } from "@/lib/horse"
import { calculateBetPotentialProfit, getBetSettlementRaceId } from "@/lib/settlement"
import { formatIso } from "@/lib/time"
import type { Bet, Race, UserProfile, UserStats } from "@/lib/types"
import { cn } from "@/lib/utils"

type MainBoardProps = {
  bets: Bet[]
  allBets: Bet[]
  users: UserProfile[]
  allUsers: UserProfile[]
  races: Race[]
  stats: UserStats[]
}

type RunnerBackerDetail = {
  betId: string
  userId: string
  userDisplayName: string
  userAvatarSrc?: string
  betType: Bet["betType"]
  stakeTotal: number
  potentialProfit: number
}

type NextRaceRunnerRow = {
  horseName: string
  horseUid?: number
  finishPosition?: number
  oddsLabel?: string
  oddsValue?: number
  isFavourite: boolean
  backers: RunnerBackerDetail[]
}

const USER_AVATAR_SRC_BY_ID: Record<string, string> = {
  fabs: "/avatars/Fabs.png",
  ru: "/avatars/Ru.png",
  shiblen: "/avatars/Shiblen.png",
  howes: "/avatars/Howes.png",
  steve: "/avatars/Steve.png",
  sean: "/avatars/Sean.png",
  gordo: "/avatars/Gordo.png",
  tim: "/avatars/Tim.png",
  wilks: "/avatars/Wilkes.png",
  grandad_packet: "/avatars/Grandad Packet.png",
}

function getUserAvatarSrc(userId: string): string | undefined {
  return USER_AVATAR_SRC_BY_ID[userId]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

function buildRankMap(entries: Array<{ userId: string; displayName: string; profitLoss: number }>): Map<string, number> {
  const sorted = [...entries].sort((a, b) => {
    if (a.profitLoss !== b.profitLoss) {
      return b.profitLoss - a.profitLoss
    }
    return a.displayName.localeCompare(b.displayName)
  })

  const rankByUser = new Map<string, number>()
  let currentRank = 1
  sorted.forEach((entry, index) => {
    if (index > 0 && entry.profitLoss < sorted[index - 1].profitLoss) {
      currentRank = index + 1
    }
    rankByUser.set(entry.userId, currentRank)
  })
  return rankByUser
}

function calculateProfitIfRaceWins(bet: Bet, raceId: string, races: Race[]): number {
  if (bet.betType !== "accumulator") {
    return calculateBetPotentialProfit(bet)
  }

  if (getBetSettlementRaceId(bet, races) !== raceId) {
    return 0
  }

  if (bet.legs.some((leg) => leg.result === "lose" || leg.result === "place")) {
    return 0
  }

  return calculateBetPotentialProfit(bet)
}

function formatFinishPosition(position: number): string {
  const suffix =
    position % 100 >= 11 && position % 100 <= 13
      ? "th"
      : position % 10 === 1
        ? "st"
        : position % 10 === 2
          ? "nd"
          : position % 10 === 3
            ? "rd"
            : "th"

  return `${position}${suffix}`
}

function buildNextRaceRunnerRows(nextRace: Race, races: Race[], bets: Bet[], users: UserProfile[]): NextRaceRunnerRow[] {
  const usersById = new Map(users.map((user) => [user.id, user]))
  const favouriteName = normalizeHorseName(nextRace.marketFavourite?.horseName ?? "")
  const oddsByUid = new Map<number, string>()
  const oddsByName = new Map<string, string>()
  const oddsValueByUid = new Map<number, number>()
  const oddsValueByName = new Map<string, number>()

  nextRace.oddsSnapshot?.forEach((entry) => {
    const label = formatMarketOdds(entry.bestFractional, entry.bestDecimal)
    if (typeof entry.horseUid === "number") {
      oddsByUid.set(entry.horseUid, label)
      oddsValueByUid.set(entry.horseUid, entry.bestDecimal)
    }
    oddsByName.set(normalizeHorseName(entry.horseName), label)
    oddsValueByName.set(normalizeHorseName(entry.horseName), entry.bestDecimal)
  })

  const runners =
    nextRace.runnersDetailed?.length
      ? nextRace.runnersDetailed
          .filter((runner) => !runner.nonRunner)
          .map((runner) => ({
            horseName: runner.horseName,
            horseUid: runner.horseUid,
            finishPosition: runner.finishPosition,
          }))
      : nextRace.runners.map((horseName) => ({ horseName, horseUid: undefined, finishPosition: undefined }))

  return runners.map((runner) => {
    const normalizedRunner = normalizeHorseName(runner.horseName)
    const backers = bets.flatMap((bet) => {
      const user = usersById.get(bet.userId)
      if (!user) {
        return []
      }
      if (bet.status === "settled" && getBetSettlementRaceId(bet, races) !== nextRace.id) {
        return []
      }

      const hasMatchingLeg = bet.legs.some((leg) => {
        if (leg.raceId !== nextRace.id) {
          return false
        }
        if (typeof runner.horseUid === "number" && typeof leg.horseUid === "number") {
          return leg.horseUid === runner.horseUid
        }
        return normalizeHorseName(leg.selectionName) === normalizedRunner
      })

      if (!hasMatchingLeg) {
        return []
      }

      return [{
        betId: bet.id,
        userId: user.id,
        userDisplayName: user.displayName,
        userAvatarSrc: getUserAvatarSrc(user.id),
        betType: bet.betType,
        stakeTotal: bet.stakeTotal,
        potentialProfit: calculateProfitIfRaceWins(bet, nextRace.id, races),
      }]
    })

    return {
      horseName: runner.horseName,
      horseUid: runner.horseUid,
      finishPosition: runner.finishPosition,
      oddsLabel:
        (typeof runner.horseUid === "number" ? oddsByUid.get(runner.horseUid) : undefined) ??
        oddsByName.get(normalizedRunner),
      oddsValue:
        (typeof runner.horseUid === "number" ? oddsValueByUid.get(runner.horseUid) : undefined) ??
        oddsValueByName.get(normalizedRunner),
      isFavourite:
        (typeof runner.horseUid === "number" && runner.horseUid === nextRace.marketFavourite?.horseUid) ||
        (Boolean(favouriteName) && normalizedRunner === favouriteName),
      backers,
    }
  }).sort((a, b) => {
    const aFinish = typeof a.finishPosition === "number" && a.finishPosition > 0 ? a.finishPosition : Number.POSITIVE_INFINITY
    const bFinish = typeof b.finishPosition === "number" && b.finishPosition > 0 ? b.finishPosition : Number.POSITIVE_INFINITY
    const showFinishingOrder = nextRace.status === "settled" || nextRace.lifecycle === "complete"

    if (showFinishingOrder && aFinish !== bFinish) {
      return aFinish - bFinish
    }

    const aOdds = typeof a.oddsValue === "number" ? a.oddsValue : Number.POSITIVE_INFINITY
    const bOdds = typeof b.oddsValue === "number" ? b.oddsValue : Number.POSITIVE_INFINITY

    if (aOdds !== bOdds) {
      return aOdds - bOdds
    }

    if (a.isFavourite !== b.isFavourite) {
      return a.isFavourite ? -1 : 1
    }

    return a.horseName.localeCompare(b.horseName)
  })
}

function buildClFavouriteSummary(runnerRows: NextRaceRunnerRow[]) {
  const candidates = runnerRows
    .map((runner) => ({
      horseName: runner.horseName,
      oddsLabel: runner.oddsLabel,
      backerCount: new Set(runner.backers.map((entry) => entry.userId)).size,
      potentialProfit: runner.backers.reduce((acc, entry) => acc + entry.potentialProfit, 0),
    }))
    .filter((runner) => runner.backerCount > 0)
    .sort((a, b) => {
      if (a.backerCount !== b.backerCount) {
        return b.backerCount - a.backerCount
      }
      if (a.potentialProfit !== b.potentialProfit) {
        return b.potentialProfit - a.potentialProfit
      }
      return a.horseName.localeCompare(b.horseName)
    })

  return candidates[0] ?? null
}

function BackerCluster({ backers }: { backers: RunnerBackerDetail[] }) {
  if (!backers.length) {
    return null
  }

  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        className="flex items-center -space-x-1.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-label={`Backed by ${backers.map((entry) => entry.userDisplayName).join(", ")}`}
      >
        {backers.map((entry) => (
          <span
            key={`${entry.betId}-${entry.userId}`}
            className="inline-flex rounded-full bg-background"
          >
            <span
              className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-background bg-muted/20 text-[10px] font-semibold text-foreground shadow-sm"
              title={entry.userDisplayName}
            >
              {entry.userAvatarSrc ? (
                <img src={entry.userAvatarSrc} alt={entry.userDisplayName} className="h-full w-full object-contain" />
              ) : (
                <span>{getInitials(entry.userDisplayName)}</span>
              )}
            </span>
          </span>
        ))}
      </button>

      <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden min-w-[220px] rounded-xl border border-border/60 bg-card px-3 py-2 text-left text-xs shadow-2xl group-hover:block group-focus-within:block">
        <div className="mb-2 font-semibold text-foreground">Backed on this horse</div>
        <div className="space-y-1.5">
          {backers.map((entry) => (
            <div key={`tooltip-${entry.betId}-${entry.userId}`} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{entry.userDisplayName}</div>
                <div className="text-[11px] text-muted-foreground">{entry.betType}</div>
              </div>
              <div className="tabular-nums text-foreground">{formatCurrency(entry.stakeTotal)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CurrentRaceCard({
  races,
  allBets,
  allUsers,
}: {
  races: Race[]
  allBets: Bet[]
  allUsers: UserProfile[]
}) {
  const orderedRaces = useMemo(
    () => [...races].sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime()),
    [races],
  )
  const defaultRaceId = useMemo(
    () => orderedRaces.find((race) => race.status !== "settled")?.id ?? orderedRaces[0]?.id ?? null,
    [orderedRaces],
  )
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(defaultRaceId)
  const resolvedSelectedRaceId =
    selectedRaceId && orderedRaces.some((race) => race.id === selectedRaceId) ? selectedRaceId : defaultRaceId
  const selectedRaceIndex = orderedRaces.findIndex((race) => race.id === resolvedSelectedRaceId)
  const currentRace =
    (selectedRaceIndex >= 0 ? orderedRaces[selectedRaceIndex] : undefined) ??
    orderedRaces.find((race) => race.id === defaultRaceId)

  if (!currentRace) {
    return (
      <Card className="shadow-xs">
        <CardContent className="py-8 text-center">
          <div className="text-sm text-muted-foreground">All races settled. Final standings above.</div>
        </CardContent>
      </Card>
    )
  }

  const raceBets = allBets.filter((bet) => bet.legs.some((leg) => leg.raceId === currentRace.id))
  const raceStaked = raceBets.reduce((acc, bet) => acc + bet.stakeTotal, 0)
  const runnerRows = buildNextRaceRunnerRows(currentRace, races, allBets, allUsers)
  const clFavourite = buildClFavouriteSummary(runnerRows)
  const canGoPrevious = selectedRaceIndex > 0
  const canGoNext = selectedRaceIndex >= 0 && selectedRaceIndex < orderedRaces.length - 1
  const isDefaultRaceView = currentRace.id === defaultRaceId
  const raceHeaderLabel = isDefaultRaceView ? "Next Race" : "Selected Race"
  const RaceHeaderIcon = isDefaultRaceView ? Clock : Flag

  return (
    <Card className="shadow-xs">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <RaceHeaderIcon className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {raceHeaderLabel}
              </span>
            </div>
            <div className="mt-1 text-base font-bold">{currentRace.name}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{formatIso(currentRace.offTime, "EEE HH:mm")}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  if (!canGoPrevious) {
                    return
                  }
                  setSelectedRaceId(orderedRaces[selectedRaceIndex - 1]?.id ?? null)
                }}
                disabled={!canGoPrevious}
                aria-label="Previous race"
              >
                <ArrowLeft className="size-3.5" />
              </button>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  if (!canGoNext) {
                    return
                  }
                  setSelectedRaceId(orderedRaces[selectedRaceIndex + 1]?.id ?? null)
                }}
                disabled={!canGoNext}
                aria-label="Next race"
              >
                <ArrowRight className="size-3.5" />
              </button>
            </div>
            <Badge variant="secondary" className="tabular-nums">{raceBets.length} bets</Badge>
            <Badge variant="outline" className="tabular-nums">{formatCurrency(raceStaked)}</Badge>
          </div>
        </div>
        {clFavourite ? (
          <div className="mt-3 rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
            <div className="grid gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">CL Favourite</span>
                <div className="text-right">
                  <div className="font-semibold text-foreground">{clFavourite.horseName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {clFavourite.backerCount} {clFavourite.backerCount === 1 ? "backer" : "backers"}
                    {clFavourite.oddsLabel ? ` • ${clFavourite.oddsLabel}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Potential winnings if it comes first</span>
                <div className="font-semibold tabular-nums text-primary">
                  {formatCurrency(clFavourite.potentialProfit)}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {runnerRows.length > 0 ? (
          <div className="mt-3 rounded-lg border border-border/40 bg-muted/10">
            <div className="border-b border-border/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Field
            </div>
            <div className="divide-y divide-border/30">
              {runnerRows.map((runner) => (
                <div key={`${runner.horseUid ?? runner.horseName}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{runner.horseName}</span>
                      {typeof runner.finishPosition === "number" && runner.finishPosition > 0 ? (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          {formatFinishPosition(runner.finishPosition)}
                        </Badge>
                      ) : null}
                      {runner.isFavourite ? <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Fav</Badge> : null}
                    </div>
                    {runner.oddsLabel ? (
                      <div className="text-[11px] text-muted-foreground">{runner.oddsLabel}</div>
                    ) : null}
                  </div>
                  <BackerCluster backers={runner.backers} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RankChange({ delta, hasSettledRace }: { delta: number; hasSettledRace: boolean }) {
  if (!hasSettledRace) {
    return <span className="text-muted-foreground">-</span>
  }

  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-primary" title={`Up ${delta}`}>
        <ArrowUpRight className="size-3.5" />
        <span className="text-xs font-semibold">+{delta}</span>
      </span>
    )
  }

  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-destructive" title={`Down ${Math.abs(delta)}`}>
        <ArrowDownRight className="size-3.5" />
        <span className="text-xs font-semibold">{delta}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center text-muted-foreground" title="No change">
      <Minus className="size-3" />
    </span>
  )
}

function formatLeagueCurrency(value: number, userId: string) {
  const formatted = formatCurrency(value)
  if (userId !== "gordo") {
    return formatted
  }

  if (formatted.startsWith("-£")) {
    return `-£00${formatted.slice(2)}`
  }

  if (formatted.startsWith("£")) {
    return `£00${formatted.slice(1)}`
  }

  return formatted
}

export function MainBoard({
  bets,
  allBets,
  users,
  allUsers,
  races,
  stats,
}: MainBoardProps) {
  const statsByUser = new Map(stats.map((entry) => [entry.userId, entry]))
  const latestSettledRace = races
    .filter((race) => race.status === "settled")
    .sort((a, b) => new Date(b.offTime).getTime() - new Date(a.offTime).getTime())[0]

  const latestRacePnlByUser = new Map<string, number>()
  if (latestSettledRace) {
    bets
      .filter((bet) => bet.status === "settled")
      .forEach((bet) => {
        const settleRaceId = getBetSettlementRaceId(bet, races)
        if (settleRaceId !== latestSettledRace.id) {
          return
        }
        latestRacePnlByUser.set(bet.userId, (latestRacePnlByUser.get(bet.userId) ?? 0) + (bet.profitLoss ?? 0))
      })
  }

  const rows = users
    .map((user) => {
      const userStats = statsByUser.get(user.id)
      if (!userStats) {
        return null
      }
      const latestRaceDelta = latestSettledRace ? latestRacePnlByUser.get(user.id) ?? 0 : 0
      return {
        user,
        userStats,
        currentProfitLoss: userStats.profitLoss,
        previousProfitLoss: userStats.profitLoss - latestRaceDelta,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  const currentRankMap = buildRankMap(
    rows.map((row) => ({
      userId: row.user.id,
      displayName: row.user.displayName,
      profitLoss: row.currentProfitLoss,
    })),
  )
  const previousRankMap = buildRankMap(
    rows.map((row) => ({
      userId: row.user.id,
      displayName: row.user.displayName,
      profitLoss: row.previousProfitLoss,
    })),
  )

  const leagueRows = [...rows]
    .map((row) => {
      const currentRank = currentRankMap.get(row.user.id) ?? 0
      const previousRank = previousRankMap.get(row.user.id) ?? currentRank
      return {
        ...row,
        currentRank,
        previousRank,
        rankDelta: previousRank - currentRank,
      }
    })
    .sort((a, b) => {
      if (a.currentRank !== b.currentRank) {
        return a.currentRank - b.currentRank
      }
      return a.user.displayName.localeCompare(b.user.displayName)
    })

  return (
    <div className="space-y-4">
      <CurrentRaceCard
        races={races}
        allBets={allBets}
        allUsers={allUsers}
      />

      <Card className="shadow-xs">
        <CardHeader>
          <div className="flex items-end justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold">League Table</CardTitle>
              {latestSettledRace ? (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Movement since {formatIso(latestSettledRace.offTime, "EEE HH:mm")}
                </div>
              ) : null}
            </div>
          </div>
        </CardHeader>

        {/* Desktop table */}
        <CardContent className="hidden md:block">
          <div className="data-table-shell p-0">
            <table className="data-table min-w-[780px]">
              <thead>
                <tr>
                  <th className="w-12 text-center">#</th>
                  <th className="w-14">Move</th>
                  <th>Name</th>
                  <th>Staked</th>
                  <th>Returns</th>
                  <th>P/L</th>
                  <th>ROAS</th>
                  <th>Win %</th>
                  <th>Bets</th>
                  <th>Best Win</th>
                  <th>Avg Stake</th>
                </tr>
              </thead>
              <tbody>
                {leagueRows.map(({ user, userStats, currentRank, rankDelta }, index) => {
                  return (
                    <tr
                      key={user.id}
                      className={cn(index === 0 && currentRank === 1 ? "!bg-primary/[0.04]" : "")}
                    >
                      <td className="text-center">
                        <span
                          className="position-badge"
                          data-pos={currentRank <= 3 ? currentRank : undefined}
                        >
                          {currentRank}
                        </span>
                      </td>
                      <td>
                        <RankChange delta={rankDelta} hasSettledRace={Boolean(latestSettledRace)} />
                      </td>
                      <td className="font-semibold">{user.displayName}</td>
                      <td className="tabular-nums">{formatLeagueCurrency(userStats.totalStaked, user.id)}</td>
                      <td className="tabular-nums">{formatLeagueCurrency(userStats.totalReturns, user.id)}</td>
                      <td className={cn(
                        "font-semibold tabular-nums",
                        userStats.profitLoss < 0 ? "text-destructive" : "text-primary",
                      )}>
                        {formatLeagueCurrency(userStats.profitLoss, user.id)}
                      </td>
                      <td className="tabular-nums">{formatPercent(userStats.roasPct)}</td>
                      <td className="tabular-nums">{formatPercent(userStats.winPct)}</td>
                      <td className="tabular-nums">{userStats.betsPlaced}</td>
                      <td className="tabular-nums">{formatLeagueCurrency(userStats.biggestWin, user.id)}</td>
                      <td className="tabular-nums">{formatLeagueCurrency(userStats.averageStake, user.id)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>

        {/* Mobile cards */}
        <CardContent className="space-y-2 md:hidden">
          {leagueRows.map(({ user, userStats, currentRank, rankDelta }) => (
            <div
              key={user.id}
              className={cn(
                "bet-card",
                currentRank === 1 ? "!border-primary/20 !bg-primary/[0.04]" : "",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className="position-badge shrink-0"
                  data-pos={currentRank <= 3 ? currentRank : undefined}
                >
                  {currentRank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold">{user.displayName}</span>
                    <RankChange delta={rankDelta} hasSettledRace={Boolean(latestSettledRace)} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{userStats.betsPlaced} bets</span>
                    <span>Staked {formatLeagueCurrency(userStats.totalStaked, user.id)}</span>
                    <span>Win {formatPercent(userStats.winPct)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn(
                    "text-sm font-bold tabular-nums",
                    userStats.profitLoss < 0 ? "text-destructive" : "text-primary",
                  )}>
                    {formatLeagueCurrency(userStats.profitLoss, user.id)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">P/L</div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
