import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatOdds } from "@/lib/format"
import { toCumulativeSeries } from "@/lib/settlement"
import { formatIso } from "@/lib/time"
import type { Bet, Race, UserProfile, UserStats } from "@/lib/types"

type PersonalPanelProps = {
  user: UserProfile | undefined
  userStats: UserStats | undefined
  bets: Bet[]
  races: Race[]
}

function findRaceName(raceId: string, races: Race[]): string {
  return races.find((race) => race.id === raceId)?.name ?? "Unknown race"
}

export function PersonalPanel({ user, userStats, bets, races }: PersonalPanelProps) {
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Stats</CardTitle>
        </CardHeader>
        <CardContent>Select your identity to view stats.</CardContent>
      </Card>
    )
  }

  const personalBets = bets.filter((bet) => bet.userId === user.id)
  const chartData = toCumulativeSeries(personalBets)

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle>{user.displayName}'s Betslip</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="panel-subtle">
            <div className="text-xs text-muted-foreground">Total Staked</div>
            <div className="text-lg font-semibold">{formatCurrency(userStats?.totalStaked ?? 0)}</div>
          </div>
          <div className="panel-subtle">
            <div className="text-xs text-muted-foreground">Total Returns</div>
            <div className="text-lg font-semibold">{formatCurrency(userStats?.totalReturns ?? 0)}</div>
          </div>
          <div className="panel-subtle">
            <div className="text-xs text-muted-foreground">P/L</div>
            <div className="text-lg font-semibold">{formatCurrency(userStats?.profitLoss ?? 0)}</div>
          </div>
          <div className="panel-subtle">
            <div className="text-xs text-muted-foreground">Bets Placed</div>
            <div className="text-lg font-semibold">{userStats?.betsPlaced ?? 0}</div>
          </div>
        </div>

        <div className="h-56 rounded-md border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
              <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="data-table-shell">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th className="py-2">When</th>
                <th>Race</th>
                <th>Selection(s)</th>
                <th>Type</th>
                <th>Odds</th>
                <th>Stake</th>
                <th>Return</th>
                <th>P/L</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {personalBets.map((bet) => (
                <tr key={bet.id} className="border-t border-border/60">
                  <td className="py-2">{formatIso(bet.createdAt)}</td>
                  <td>{bet.legs.map((leg) => findRaceName(leg.raceId, races)).join(" + ")}</td>
                  <td>{bet.legs.map((leg) => leg.selectionName).join(" + ")}</td>
                  <td>{bet.betType}</td>
                  <td>{bet.legs.map((leg) => formatOdds(leg.decimalOdds)).join(" x ")}</td>
                  <td>{formatCurrency(bet.stakeTotal)}</td>
                  <td>{formatCurrency(bet.totalReturn ?? 0)}</td>
                  <td className={(bet.profitLoss ?? 0) < 0 ? "text-destructive" : "text-primary"}>
                    {formatCurrency(bet.profitLoss ?? 0)}
                  </td>
                  <td>{bet.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
