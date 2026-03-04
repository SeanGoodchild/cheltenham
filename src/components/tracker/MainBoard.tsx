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

export function MainBoard({ bets, users, races, stats }: MainBoardProps) {
  const statsByUser = new Map(stats.map((entry) => [entry.userId, entry]))

  return (
    <div className="space-y-4">
      <CurrentRaceCard races={races} bets={bets} />

      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle>League Table</CardTitle>
        </CardHeader>
        <CardContent className="data-table-shell p-0">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
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
              {users.map((user) => {
                const userStats = statsByUser.get(user.id)
                if (!userStats) {
                  return null
                }

                return (
                  <tr key={user.id}>
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
