import { useState } from "react"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatOdds } from "@/lib/format"
import { calculateBetPotentialReturn, resolveBetOddsUsed, toCumulativeSeries } from "@/lib/settlement"
import { formatIso } from "@/lib/time"
import type { Bet, Race, UserProfile, UserStats } from "@/lib/types"

type PersonalPanelProps = {
  users: UserProfile[]
  user: UserProfile | undefined
  userStats: UserStats | undefined
  bets: Bet[]
  races: Race[]
  selectedSummaryUserId: string
  onSelectSummaryUserId: (userId: string) => void
  onResolveOtherBet: (input: { betId: string; totalReturn: number }) => Promise<void>
}

function findRaceName(raceId: string, races: Race[]): string {
  return races.find((race) => race.id === raceId)?.name ?? "Unknown race"
}

export function PersonalPanel({
  users,
  user,
  userStats,
  bets,
  races,
  selectedSummaryUserId,
  onSelectSummaryUserId,
  onResolveOtherBet,
}: PersonalPanelProps) {
  const [manualReturnByBetId, setManualReturnByBetId] = useState<Record<string, string>>({})
  const [resolvingBetId, setResolvingBetId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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

  const handleManualResolve = async (bet: Bet) => {
    const rawValue = manualReturnByBetId[bet.id] ?? ""
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0) {
      setActionError("Enter a valid return amount (0 or greater) before settling.")
      return
    }

    setActionError(null)
    setResolvingBetId(bet.id)
    try {
      await onResolveOtherBet({ betId: bet.id, totalReturn: value })
      setManualReturnByBetId((prev) => {
        const next = { ...prev }
        delete next[bet.id]
        return next
      })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to manually settle other bet")
    } finally {
      setResolvingBetId(null)
    }
  }

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardTitle>{user.displayName}'s Betslip</CardTitle>
          <div className="w-full max-w-[240px] space-y-1">
            <Label htmlFor="summary-user-select" className="text-xs text-muted-foreground">
              View lad
            </Label>
            <select
              id="summary-user-select"
              className="native-select"
              value={selectedSummaryUserId}
              onChange={(event) => onSelectSummaryUserId(event.target.value)}
            >
              {users.map((entry) => (
                <option key={`summary-user-${entry.id}`} value={entry.id}>
                  {entry.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
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

        {actionError ? <div className="text-sm text-destructive">{actionError}</div> : null}

        <div className="data-table-shell">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                <th className="py-2">When</th>
                <th>Race</th>
                <th>Selection(s)</th>
                <th>Type</th>
                <th>Odds Used</th>
                <th>Stake</th>
                <th>Potential Win</th>
                <th>Return</th>
                <th>P/L</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {personalBets.map((bet) => {
                const oddsUsed = resolveBetOddsUsed(bet)
                const potentialWin = Math.max(0, calculateBetPotentialReturn(bet) - bet.stakeTotal)
                const isSettled = bet.status === "settled"
                const canManuallyResolveOther = bet.betType === "other" && !isSettled
                const betRaceLabel =
                  bet.betType === "other" ? "Custom" : bet.legs.map((leg) => findRaceName(leg.raceId, races)).join(" + ")
                const betSelectionLabel =
                  bet.betType === "other"
                    ? (bet.betName?.trim() || "Other bet")
                    : bet.legs.map((leg) => leg.selectionName).join(" + ")
                const returnLabel = isSettled ? formatCurrency(bet.totalReturn ?? 0) : "—"
                const profitLossValue = isSettled ? (bet.profitLoss ?? 0) : null
                const profitLossLabel = isSettled ? formatCurrency(profitLossValue ?? 0) : "—"
                const manualDraftValue = manualReturnByBetId[bet.id] ?? ""

                return (
                  <tr key={bet.id} className="border-t border-border/60">
                    <td className="py-2">{formatIso(bet.createdAt)}</td>
                    <td>{betRaceLabel}</td>
                    <td>{betSelectionLabel}</td>
                    <td>{bet.betType}</td>
                    <td>{oddsUsed ? formatOdds(oddsUsed) : "N/A"}</td>
                    <td>{formatCurrency(bet.stakeTotal)}</td>
                    <td>{formatCurrency(potentialWin)}</td>
                    <td>{returnLabel}</td>
                    <td className={profitLossValue !== null && profitLossValue < 0 ? "text-destructive" : "text-primary"}>
                      {profitLossLabel}
                    </td>
                    <td>{bet.status}</td>
                    <td>
                      {canManuallyResolveOther ? (
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label={`Manual return for ${betSelectionLabel}`}
                            className="h-8 w-24"
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="Return"
                            value={manualDraftValue}
                            onChange={(event) =>
                              setManualReturnByBetId((prev) => ({
                                ...prev,
                                [bet.id]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={resolvingBetId === bet.id}
                            onClick={() => {
                              void handleManualResolve(bet)
                            }}
                          >
                            {resolvingBetId === bet.id ? "Settling..." : "Settle"}
                          </Button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
