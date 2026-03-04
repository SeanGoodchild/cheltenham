import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatOdds, formatPercent } from "@/lib/format"
import { formatIso } from "@/lib/time"
import type { Bet, Race, UserProfile, UserStats } from "@/lib/types"

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
        <CardHeader>
          <CardTitle>Next Race</CardTitle>
        </CardHeader>
        <CardContent>No upcoming races.</CardContent>
      </Card>
    )
  }

  const raceBets = bets.filter((bet) => bet.legs.some((leg) => leg.raceId === nextRace.id))
  const raceStaked = raceBets.reduce((acc, bet) => acc + bet.stakeTotal, 0)

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle>Next Race</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-lg font-semibold">{nextRace.name}</div>
        <div className="text-sm text-muted-foreground">{formatIso(nextRace.offTime, "EEE HH:mm")}</div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{raceBets.length} bets</Badge>
          <Badge variant="outline">{formatCurrency(raceStaked)} staked</Badge>
        </div>
        {nextRace.marketFavourite ? (
          <div className="rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
            Market favourite (IrishRacing):{" "}
            <span className="font-medium text-foreground">{nextRace.marketFavourite.horseName}</span>{" "}
            at {nextRace.marketFavourite.bestFractional} ({formatOdds(nextRace.marketFavourite.bestDecimal)})
          </div>
        ) : null}
      </CardContent>
    </Card>
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
          <CardTitle>League Table</CardTitle>
          {latestSettledRace ? (
            <div className="text-xs text-muted-foreground">
              Position change vs latest result ({formatIso(latestSettledRace.offTime, "EEE HH:mm")}).
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="data-table-shell p-0">
          <table className="data-table min-w-[820px]">
            <thead>
              <tr>
                <th className="py-2">Pos</th>
                <th>Move</th>
                <th className="py-2">Mate</th>
                <th>Staked</th>
                <th>Returns</th>
                <th>P/L</th>
                <th>ROAS</th>
                <th>Win %</th>
                <th>Bets</th>
                <th>Biggest Win</th>
                <th>Avg Stake</th>
              </tr>
            </thead>
            <tbody>
              {leagueRows.map(({ user, userStats, currentRank, rankDelta }) => {
                return (
                  <tr key={user.id}>
                    <td className="py-2 font-semibold">{currentRank}</td>
                    <td className="py-2">
                      {!latestSettledRace ? (
                        <span className="inline-flex items-center text-muted-foreground">
                          <Minus className="mr-1 size-3.5" />
                          —
                        </span>
                      ) : rankDelta > 0 ? (
                        <span className="inline-flex items-center text-primary" title={`Up ${rankDelta} place(s)`}>
                          <ArrowUpRight className="mr-1 size-3.5" />
                          +{rankDelta}
                        </span>
                      ) : rankDelta < 0 ? (
                        <span
                          className="inline-flex items-center text-destructive"
                          title={`Down ${Math.abs(rankDelta)} place(s)`}
                        >
                          <ArrowDownRight className="mr-1 size-3.5" />
                          {rankDelta}
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-muted-foreground" title="No change">
                          <Minus className="mr-1 size-3.5" />
                          0
                        </span>
                      )}
                    </td>
                    <td className="py-2 font-medium">{user.displayName}</td>
                    <td>{formatCurrency(userStats.totalStaked)}</td>
                    <td>{formatCurrency(userStats.totalReturns)}</td>
                    <td className={userStats.profitLoss < 0 ? "text-destructive" : "text-primary"}>
                      {formatCurrency(userStats.profitLoss)}
                    </td>
                    <td>{formatPercent(userStats.roasPct)}</td>
                    <td>{formatPercent(userStats.winPct)}</td>
                    <td>{userStats.betsPlaced}</td>
                    <td>{formatCurrency(userStats.biggestWin)}</td>
                    <td>{formatCurrency(userStats.averageStake)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
