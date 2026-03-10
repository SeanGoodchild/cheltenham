import { useState } from "react"
import { ChevronRight, Pencil } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { ManualBetEditInput } from "@/lib/firebase"
import { formatCurrency, formatOdds } from "@/lib/format"
import { calculateBetPotentialProfit, getBetRiskStake, resolveBetOddsUsed } from "@/lib/settlement"
import { formatIso } from "@/lib/time"
import type { Bet, Race, UserProfile } from "@/lib/types"
import { cn } from "@/lib/utils"

type PersonalPanelProps = {
  user: UserProfile | undefined
  bets: Bet[]
  races: Race[]
  onManualEditBet: (input: ManualBetEditInput & { betId: string }) => Promise<void>
  onResolveOtherBet: (input: { betId: string; totalReturn: number }) => Promise<void>
}

type EditBetDraft = {
  betId: string
  betType: Bet["betType"]
  betName: string
  legs: Array<{
    raceId: string
    selectionName: string
    decimalOdds: string
    horseUid?: number
  }>
  oddsUsed: string
  stakeTotal: string
  isFreeBet: boolean
  placesPaid: string
  placeFraction: string
  status: Bet["status"]
  totalReturn: string
}

function findRaceName(raceId: string, races: Race[]): string {
  return races.find((race) => race.id === raceId)?.name ?? "Unknown race"
}

function createEditDraft(bet: Bet): EditBetDraft {
  return {
    betId: bet.id,
    betType: bet.betType,
    betName: bet.betName ?? "",
    legs: bet.legs.map((leg) => ({
      raceId: leg.raceId,
      selectionName: leg.selectionName,
      decimalOdds: String(leg.decimalOdds ?? ""),
      horseUid: leg.horseUid,
    })),
    oddsUsed: bet.oddsUsed ? String(bet.oddsUsed) : "",
    stakeTotal: String(bet.stakeTotal),
    isFreeBet: Boolean(bet.isFreeBet),
    placesPaid: String(bet.ewTerms?.placesPaid ?? 3),
    placeFraction: String(bet.ewTerms?.placeFraction ?? 0.2),
    status: bet.status,
    totalReturn: typeof bet.totalReturn === "number" ? String(bet.totalReturn) : "",
  }
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
  onManualEditBet,
  onResolveOtherBet,
}: PersonalPanelProps) {
  const [manualReturnByBetId, setManualReturnByBetId] = useState<Record<string, string>>({})
  const [resolvingBetId, setResolvingBetId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditBetDraft | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
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
  const totalStaked = personalBets.reduce((acc, bet) => acc + getBetRiskStake(bet), 0)
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

  const openEditModal = (bet: Bet) => {
    setActionError(null)
    setEditDraft(createEditDraft(bet))
  }

  const closeEditModal = () => {
    if (savingEdit) {
      return
    }
    setEditDraft(null)
  }

  const handleSaveEdit = async () => {
    if (!user || !editDraft) {
      return
    }

    const stakeTotal = Number(editDraft.stakeTotal)
    const oddsUsed = editDraft.oddsUsed.trim() === "" ? null : Number(editDraft.oddsUsed)
    const totalReturn = editDraft.totalReturn.trim() === "" ? null : Number(editDraft.totalReturn)
    const legs = editDraft.legs.map((leg) => ({
      raceId: leg.raceId,
      selectionName: leg.selectionName.trim(),
      decimalOdds: Number(leg.decimalOdds),
      horseUid: leg.horseUid,
    }))

    if (!Number.isFinite(stakeTotal) || stakeTotal <= 0) {
      setActionError("Stake must be greater than zero.")
      return
    }
    if (legs.some((leg) => !leg.selectionName || !Number.isFinite(leg.decimalOdds) || leg.decimalOdds < 1)) {
      setActionError("Every leg needs a selection and decimal odds of at least 1.0.")
      return
    }
    if (oddsUsed !== null && (!Number.isFinite(oddsUsed) || oddsUsed < 1)) {
      setActionError("Final odds must be blank or at least 1.0.")
      return
    }
    if (totalReturn !== null && (!Number.isFinite(totalReturn) || totalReturn < 0)) {
      setActionError("Return must be blank or a valid number greater than or equal to zero.")
      return
    }
    if (
      editDraft.betType === "each_way" &&
      (
        !Number.isFinite(Number(editDraft.placesPaid)) ||
        Number(editDraft.placesPaid) < 1 ||
        !Number.isFinite(Number(editDraft.placeFraction)) ||
        Number(editDraft.placeFraction) <= 0
      )
    ) {
      setActionError("Each-way terms need valid places paid and place fraction values.")
      return
    }

    setActionError(null)
    setSavingEdit(true)
    try {
      await onManualEditBet({
        betId: editDraft.betId,
        userId: user.id,
        betType: editDraft.betType,
        betName: editDraft.betName.trim() || undefined,
        legs,
        oddsUsed,
        stakeTotal,
        isFreeBet: editDraft.isFreeBet,
        ewTerms:
          editDraft.betType === "each_way"
            ? {
                placesPaid: Number(editDraft.placesPaid),
                placeFraction: Number(editDraft.placeFraction),
              }
            : undefined,
        status: editDraft.status,
        totalReturn,
      })
      setEditDraft(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to save bet changes")
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <Card className="shadow-xs">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold">{user.displayName}'s Toots</h2>
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
              No toots placed yet. Head to the Toot tab to get started.
            </CardContent>
          </Card>
        ) : null}
        {personalBets.map((bet) => {
          const oddsUsed = resolveBetOddsUsed(bet)
          const potentialWin = calculateBetPotentialProfit(bet)
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
                    {bet.manualOverride?.lockedByUser ? <Badge variant="outline" className="text-[10px]">Manual</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{betRaceLabel}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{bet.betType}</span>
                    <span>{formatCurrency(bet.stakeTotal)}</span>
                    {bet.isFreeBet ? <span>Free bet</span> : null}
                    {oddsUsed ? <span>@ {formatOdds(oddsUsed)}</span> : null}
                    <ChevronRight className="size-3" />
                    <span className="font-medium text-foreground">{formatCurrency(potentialWin)}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Edit ${betSelectionLabel}`}
                    onClick={() => openEditModal(bet)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
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
                  const potentialWin = calculateBetPotentialProfit(bet)
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
                      <td>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={bet.status} />
                          {bet.manualOverride?.lockedByUser ? <Badge variant="outline" className="text-[10px]">Manual</Badge> : null}
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(bet)}
                          >
                            <Pencil className="size-3.5" />
                            Edit
                          </Button>
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
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editDraft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 p-4 backdrop-blur-xs"
          onClick={closeEditModal}
        >
          <div
            className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl bg-background p-6 ring-1 ring-foreground/10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6">
              <h3 className="text-lg font-medium">Edit Toot</h3>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Stake</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={editDraft.stakeTotal}
                    onChange={(event) =>
                      setEditDraft((prev) => prev ? { ...prev, stakeTotal: event.target.value } : prev)
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Final Odds</span>
                  <Input
                    type="number"
                    min={1}
                    step={0.01}
                    value={editDraft.oddsUsed}
                    onChange={(event) =>
                      setEditDraft((prev) => prev ? { ...prev, oddsUsed: event.target.value } : prev)
                    }
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Status</span>
                  <select
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    value={editDraft.status}
                    onChange={(event) =>
                      setEditDraft((prev) => prev ? { ...prev, status: event.target.value as Bet["status"] } : prev)
                    }
                  >
                    <option value="open">Open</option>
                    <option value="locked">Locked</option>
                    <option value="settled">Settled</option>
                    <option value="void">Void</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Return</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={editDraft.totalReturn}
                    onChange={(event) =>
                      setEditDraft((prev) => prev ? { ...prev, totalReturn: event.target.value } : prev)
                    }
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={editDraft.isFreeBet}
                  onChange={(event) =>
                    setEditDraft((prev) => prev ? { ...prev, isFreeBet: event.target.checked } : prev)
                  }
                />
                Free bet
              </label>

              {editDraft.betType === "other" ? (
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Bet Name</span>
                  <Input
                    value={editDraft.betName}
                    onChange={(event) =>
                      setEditDraft((prev) => prev ? { ...prev, betName: event.target.value } : prev)
                    }
                  />
                </label>
              ) : (
                <div className="grid gap-3">
                  {editDraft.legs.map((leg, index) => (
                    <div key={`${leg.raceId}-${index}`} className="grid gap-3 rounded-xl border border-border/50 p-3 md:grid-cols-[minmax(0,1fr)_140px]">
                      <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">{findRaceName(leg.raceId, races)}</span>
                        <Input
                          value={leg.selectionName}
                          onChange={(event) =>
                            setEditDraft((prev) => prev
                              ? {
                                  ...prev,
                                  legs: prev.legs.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, selectionName: event.target.value } : entry),
                                }
                              : prev)
                          }
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">Leg Odds</span>
                        <Input
                          type="number"
                          min={1}
                          step={0.01}
                          value={leg.decimalOdds}
                          onChange={(event) =>
                            setEditDraft((prev) => prev
                              ? {
                                  ...prev,
                                  legs: prev.legs.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, decimalOdds: event.target.value } : entry),
                                }
                              : prev)
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}

              {editDraft.betType === "each_way" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium">Places Paid</span>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={editDraft.placesPaid}
                      onChange={(event) =>
                        setEditDraft((prev) => prev ? { ...prev, placesPaid: event.target.value } : prev)
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium">Place Fraction</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.05}
                      value={editDraft.placeFraction}
                      onChange={(event) =>
                        setEditDraft((prev) => prev ? { ...prev, placeFraction: event.target.value } : prev)
                      }
                    />
                  </label>
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={savingEdit} onClick={closeEditModal}>
                Cancel
              </Button>
              <Button type="button" disabled={savingEdit} onClick={() => {
                void handleSaveEdit()
              }}>
                {savingEdit ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
