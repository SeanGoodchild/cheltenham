import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatCurrency, formatOdds } from "@/lib/format"
import { calculateBetPotentialReturn, resolveBetOddsUsed } from "@/lib/settlement"
import { formatIso } from "@/lib/time"
import type { Bet, Race, UserProfile } from "@/lib/types"

type PersonalPanelProps = {
  user: UserProfile | undefined
  bets: Bet[]
  races: Race[]
  onResolveOtherBet: (input: { betId: string; totalReturn: number }) => Promise<void>
}

function findRaceName(raceId: string, races: Race[]): string {
  return races.find((race) => race.id === raceId)?.name ?? "Unknown race"
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
        <CardHeader>
          <CardTitle>My Summary</CardTitle>
        </CardHeader>
        <CardContent>Select your identity to view your betslip.</CardContent>
      </Card>
    )
  }

  const personalBets = bets.filter((bet) => bet.userId === user.id)

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
        <CardTitle>{user.displayName}'s Betslip</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
