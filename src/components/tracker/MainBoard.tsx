import { ArrowDownRight, ArrowUpRight, Clock, Minus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatOdds, formatPercent } from "@/lib/format"
import { formatIso } from "@/lib/time"
import type { Bet, Race, UserProfile, UserStats } from "@/lib/types"
import { cn } from "@/lib/utils"

type MainBoardProps = {
  bets: Bet[]
  users: UserProfile[]
  races: Race[]
  stats: UserStats[]
}

function getSettlementRaceId(bet: Bet, races: Race[]): string | null {
  if (!bet.legs.length) {
    return null
  }

  const legsWithRace = bet.legs
    .map((leg) => ({
      raceId: leg.raceId,
      offTime: races.find((race) => race.id === leg.raceId)?.offTime,
    }))
    .filter((entry): entry is { raceId: string; offTime: string } => Boolean(entry.offTime))

  if (!legsWithRace.length) {
    return null
  }

  return legsWithRace.sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime()).at(-1)?.raceId ?? null
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

function CurrentRaceCard({ races, bets }: { races: Race[]; bets: Bet[] }) {
  const nextRace = races
    .filter((race) => race.status !== "settled")
    .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())[0]

  if (!nextRace) {
    return (
      <Card className="shadow-xs">
        <CardContent className="py-8 text-center">
          <div className="text-sm text-muted-foreground">All races settled. Final standings above.</div>
        </CardContent>
      </Card>
    )
  }

  const raceBets = bets.filter((bet) => bet.legs.some((leg) => leg.raceId === nextRace.id))
  const raceStaked = raceBets.reduce((acc, bet) => acc + bet.stakeTotal, 0)

  return (
    <Card className="shadow-xs">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Next Race</span>
            </div>
            <div className="mt-1.5 text-base font-bold">{nextRace.name}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{formatIso(nextRace.offTime, "EEE HH:mm")}</div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="secondary" className="tabular-nums">{raceBets.length} bets</Badge>
            <Badge variant="outline" className="tabular-nums">{formatCurrency(raceStaked)}</Badge>
          </div>
        </div>
        {nextRace.marketFavourite ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/40 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
            <span>Fav:</span>
            <span className="font-medium text-foreground">{nextRace.marketFavourite.horseName}</span>
            <span>{nextRace.marketFavourite.bestFractional} ({formatOdds(nextRace.marketFavourite.bestDecimal)})</span>
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

export function MainBoard({
  bets,
  users,
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
        const settleRaceId = getSettlementRaceId(bet, races)
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
      <CurrentRaceCard races={races} bets={bets} />

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
                      <td className="tabular-nums">{formatCurrency(userStats.totalStaked)}</td>
                      <td className="tabular-nums">{formatCurrency(userStats.totalReturns)}</td>
                      <td className={cn(
                        "font-semibold tabular-nums",
                        userStats.profitLoss < 0 ? "text-destructive" : "text-primary",
                      )}>
                        {formatCurrency(userStats.profitLoss)}
                      </td>
                      <td className="tabular-nums">{formatPercent(userStats.roasPct)}</td>
                      <td className="tabular-nums">{formatPercent(userStats.winPct)}</td>
                      <td className="tabular-nums">{userStats.betsPlaced}</td>
                      <td className="tabular-nums">{formatCurrency(userStats.biggestWin)}</td>
                      <td className="tabular-nums">{formatCurrency(userStats.averageStake)}</td>
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
                    <span>Staked {formatCurrency(userStats.totalStaked)}</span>
                    <span>Win {formatPercent(userStats.winPct)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn(
                    "text-sm font-bold tabular-nums",
                    userStats.profitLoss < 0 ? "text-destructive" : "text-primary",
                  )}>
                    {formatCurrency(userStats.profitLoss)}
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
