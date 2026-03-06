import { useState } from "react"
import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatCurrency, formatOdds } from "@/lib/format"
import { calculateBetPotentialReturn, resolveBetOddsUsed } from "@/lib/settlement"
import { formatIso } from "@/lib/time"
import type { Bet, Race, UserProfile } from "@/lib/types"
import { cn } from "@/lib/utils"

type PersonalPanelProps = {
  user: UserProfile | undefined
  bets: Bet[]
  races: Race[]
  onResolveOtherBet: (input: { betId: string; totalReturn: number }) => Promise<void>
}

function findRaceName(raceId: string, races: Race[]): string {
  return races.find((race) => race.id === raceId)?.name ?? "Unknown race"
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    settled: { variant: "default", label: "Settled" },
    open: { variant: "secondary", label: "Open" },
    locked: { variant: "outline", label: "Locked" },
    void: { variant: "destructive", label: "Void" },
  }
  const entry = config[status] ?? { variant: "outline", label: status }
  return <Badge variant={entry.variant} className="text-[10px]">{entry.label}</Badge>
}

export function PersonalPanel({
  user,
  bets,
  races,
  onResolveOtherBet,
}: PersonalPanelProps) {
  const [manualReturnByBetId, setManualReturnByBetId] = useState<Record<string, string>>({})
  const [resolvingBetId, setResolvingBetId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (!user) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-sm text-muted-foreground">Select your identity to view your bets.</div>
        </CardContent>
      </Card>
    )
  }

  const personalBets = bets.filter((bet) => bet.userId === user.id)
  const totalStaked = personalBets.reduce((acc, b) => acc + b.stakeTotal, 0)
  const settledBets = personalBets.filter((b) => b.status === "settled")
  const totalPnl = settledBets.reduce((acc, b) => acc + (b.profitLoss ?? 0), 0)

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
      setActionError(error instanceof Error ? error.message : "Failed to settle")
    } finally {
      setResolvingBetId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <Card className="shadow-xs">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold">{user.displayName}'s Bets</h2>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {personalBets.length} bets &middot; {formatCurrency(totalStaked)} staked
              </div>
            </div>
            <div className="text-right">
              <div className={cn(
                "text-lg font-bold tabular-nums",
                totalPnl >= 0 ? "text-primary" : "text-destructive",
              )}>
                {formatCurrency(totalPnl)}
              </div>
              <div className="text-[11px] text-muted-foreground">Total P/L</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {actionError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      {/* Mobile card view */}
      <div className="space-y-2 md:hidden">
        {personalBets.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No bets placed yet. Head to the Bet tab to get started.
            </CardContent>
          </Card>
        ) : null}
        {personalBets.map((bet) => {
          const oddsUsed = resolveBetOddsUsed(bet)
          const potentialWin = Math.max(0, calculateBetPotentialReturn(bet) - bet.stakeTotal)
          const isSettled = bet.status === "settled"
          const canManuallyResolveOther = bet.betType === "other" && !isSettled
          const betSelectionLabel =
            bet.betType === "other"
              ? (bet.betName?.trim() || "Other bet")
              : bet.legs.map((leg) => leg.selectionName).join(" + ")
          const betRaceLabel =
            bet.betType === "other" ? "Custom" : bet.legs.map((leg) => findRaceName(leg.raceId, races)).join(", ")
          const profitLossValue = isSettled ? (bet.profitLoss ?? 0) : null
          const manualDraftValue = manualReturnByBetId[bet.id] ?? ""

          return (
            <div key={bet.id} className="bet-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{betSelectionLabel}</span>
                    <StatusBadge status={bet.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{betRaceLabel}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{bet.betType}</span>
                    <span>{formatCurrency(bet.stakeTotal)}</span>
                    {oddsUsed ? <span>@ {formatOdds(oddsUsed)}</span> : null}
                    <ChevronRight className="size-3" />
                    <span className="font-medium text-foreground">{formatCurrency(potentialWin)}</span>
                  </div>
                </div>
                {profitLossValue !== null ? (
                  <div className="text-right">
                    <div className={cn(
                      "text-sm font-bold tabular-nums",
                      profitLossValue < 0 ? "text-destructive" : "text-primary",
                    )}>
                      {formatCurrency(profitLossValue)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Return {formatCurrency(bet.totalReturn ?? 0)}
                    </div>
                  </div>
                ) : null}
              </div>
              {canManuallyResolveOther ? (
                <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3">
                  <Input
                    aria-label={`Return for ${betSelectionLabel}`}
                    className="h-8 w-24"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Return £"
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
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Desktop table view */}
      <Card className="hidden shadow-xs md:block">
        <CardContent>
          <div className="data-table-shell">
            <table className="data-table min-w-[920px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Race</th>
                  <th>Selection</th>
                  <th>Type</th>
                  <th>Odds</th>
                  <th>Stake</th>
                  <th>Pot. Win</th>
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
                  const returnLabel = isSettled ? formatCurrency(bet.totalReturn ?? 0) : "-"
                  const profitLossValue = isSettled ? (bet.profitLoss ?? 0) : null
                  const profitLossLabel = isSettled ? formatCurrency(profitLossValue ?? 0) : "-"
                  const manualDraftValue = manualReturnByBetId[bet.id] ?? ""

                  return (
                    <tr key={bet.id}>
                      <td className="text-muted-foreground">{formatIso(bet.createdAt)}</td>
                      <td className="max-w-[140px] truncate">{betRaceLabel}</td>
                      <td className="max-w-[140px] truncate font-medium">{betSelectionLabel}</td>
                      <td>{bet.betType}</td>
                      <td className="tabular-nums">{oddsUsed ? formatOdds(oddsUsed) : "-"}</td>
                      <td className="tabular-nums">{formatCurrency(bet.stakeTotal)}</td>
                      <td className="tabular-nums">{formatCurrency(potentialWin)}</td>
                      <td className="tabular-nums">{returnLabel}</td>
                      <td className={cn(
                        "font-semibold tabular-nums",
                        profitLossValue !== null && profitLossValue < 0 ? "text-destructive" : "text-primary",
                      )}>
                        {profitLossLabel}
                      </td>
                      <td><StatusBadge status={bet.status} /></td>
                      <td>
                        {canManuallyResolveOther ? (
                          <div className="flex items-center gap-2">
                            <Input
                              aria-label={`Return for ${betSelectionLabel}`}
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
                              {resolvingBetId === bet.id ? "..." : "Settle"}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
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
    </div>
  )
}
