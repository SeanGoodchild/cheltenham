import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Check, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatOdds } from "@/lib/format"
import { normalizeHorseName } from "@/lib/horse"
import { calculateBetPotentialProfit, getBetRiskStake, resolveBetOddsUsed } from "@/lib/settlement"
import { formatIso } from "@/lib/time"
import type { Bet, BetType, Race, RaceDay } from "@/lib/types"
import { cn } from "@/lib/utils"

export type BetDraftForm = {
  userId: string
  betType: BetType
  betName?: string
  stakeTotal: number
  isFreeBet?: boolean
  oddsUsed?: number | null
  ewTerms?: {
    placesPaid: number
    placeFraction: number
  }
  legs: Array<{
    raceId: string
    selectionName: string
    decimalOdds: number | null
    horseUid?: number
  }>
}

type BetPanelProps = {
  races: Race[]
  bets: Bet[]
  selectedUserId: string
  onCreateBet: (draft: BetDraftForm) => Promise<void>
  onUpdateBet: (betId: string, draft: BetDraftForm, currentBet: Bet) => Promise<void>
  onDeleteBet: (bet: Bet) => Promise<void>
}

function isValidOdds(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
}

function computeAccumulatorDraftOdds(legs: BetDraftForm["legs"]): number | null {
  if (!legs.length) {
    return null
  }

  const values = legs.map((leg) => leg.decimalOdds).filter(isValidOdds)
  if (values.length !== legs.length) {
    return null
  }

  const combined = values.reduce((acc, odds) => acc * Number(odds), 1)
  return Number.isFinite(combined) ? Math.round(combined * 10000) / 10000 : null
}

function formatStakeInput(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.00"
  }
  return value.toFixed(2)
}

function buildEmptyLeg(race?: Race): BetDraftForm["legs"][number] {
  return {
    raceId: race?.id ?? "",
    selectionName: "",
    decimalOdds: null,
    horseUid: undefined,
  }
}

function buildQuickPickForRace(race?: Race): { day?: RaceDay; time?: string } {
  if (!race) {
    return {}
  }

  return {
    day: race.day,
    time: formatIso(race.offTime, "HH:mm"),
  }
}

function newDraft(userId: string, nextRace?: Race): BetDraftForm {
  return {
    userId,
    betType: "single",
    betName: "",
    stakeTotal: 5,
    isFreeBet: false,
    oddsUsed: null,
    ewTerms: {
      placesPaid: 3,
      placeFraction: 0.2,
    },
    legs: [buildEmptyLeg(nextRace)],
  }
}

function findMarketDecimalOdds(race: Race | undefined, selectionName: string, horseUid?: number): number | null {
  if (!race || !Array.isArray(race.oddsSnapshot) || race.oddsSnapshot.length === 0) {
    return null
  }

  const normalizedSelection = normalizeHorseName(selectionName)
  if (!normalizedSelection) {
    return null
  }

  const byUid =
    typeof horseUid === "number" ? race.oddsSnapshot.find((entry) => entry.horseUid === horseUid) : undefined
  const byName = race.oddsSnapshot.find(
    (entry) => normalizeHorseName(entry.horseName) === normalizedSelection,
  )
  const bestDecimal = byUid?.bestDecimal ?? byName?.bestDecimal

  return Number.isFinite(bestDecimal) && Number(bestDecimal) >= 1 ? Number(bestDecimal) : null
}

const BET_TYPE_OPTIONS: Array<{ value: BetType; label: string }> = [
  { value: "single", label: "Single" },
  { value: "each_way", label: "Each Way" },
  { value: "accumulator", label: "Acca" },
  { value: "other", label: "Other" },
]

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "settled"
      ? "default"
      : status === "open"
        ? "secondary"
        : "outline"
  return <Badge variant={variant} className="text-[10px]">{status}</Badge>
}

export function BetPanel({
  races,
  bets,
  selectedUserId,
  onCreateBet,
  onUpdateBet,
  onDeleteBet,
}: BetPanelProps) {
  const dayOrder: RaceDay[] = ["Tuesday", "Wednesday", "Thursday", "Friday"]
  const racesSorted = useMemo(
    () => [...races].sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime()),
    [races],
  )

  const currentOpenBets = useMemo(
    () => bets.filter((bet) => bet.userId === selectedUserId && bet.status === "open"),
    [bets, selectedUserId],
  )
  const nextRace = useMemo(
    () =>
      racesSorted.find((race) => new Date(race.offTime).getTime() > Date.now()) ??
      racesSorted.find((race) => race.status !== "settled" && race.status !== "result_pending"),
    [racesSorted],
  )
  const [draft, setDraft] = useState<BetDraftForm>(() => newDraft(selectedUserId, nextRace))
  const [editingBetId, setEditingBetId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [stakeInput, setStakeInput] = useState("")
  const [placesPaidInput, setPlacesPaidInput] = useState("3")
  const [placeFractionInput, setPlaceFractionInput] = useState("0.2")
  const [quickRacePicks, setQuickRacePicks] = useState<Record<number, { day?: RaceDay; time?: string }>>({
    0: buildQuickPickForRace(nextRace),
  })
  const [accaOddsManuallySet, setAccaOddsManuallySet] = useState(false)
  const [showAllOpenBets, setShowAllOpenBets] = useState(false)
  const nextRaceRef = useRef(nextRace)

  useEffect(() => {
    nextRaceRef.current = nextRace
  }, [nextRace])

  const resetDraft = (userId: string) => {
    const nextDraft = newDraft(userId, nextRace)
    setDraft(nextDraft)
    setStakeInput("")
    setPlacesPaidInput(String(nextDraft.ewTerms?.placesPaid ?? 3))
    setPlaceFractionInput(String(nextDraft.ewTerms?.placeFraction ?? 0.2))
    setEditingBetId(null)
    setQuickRacePicks({ 0: buildQuickPickForRace(nextRace) })
    setAccaOddsManuallySet(false)
  }

  useEffect(() => {
    const nextDraft = newDraft(selectedUserId, nextRaceRef.current)
    setDraft(nextDraft)
    setStakeInput("")
    setPlacesPaidInput(String(nextDraft.ewTerms?.placesPaid ?? 3))
    setPlaceFractionInput(String(nextDraft.ewTerms?.placeFraction ?? 0.2))
    setEditingBetId(null)
    setQuickRacePicks({ 0: buildQuickPickForRace(nextRaceRef.current) })
    setActionError(null)
    setAccaOddsManuallySet(false)
  }, [selectedUserId])

  const hydrateFromBet = (bet: Bet) => {
    setEditingBetId(bet.id)
    const computedAccaOdds = bet.betType === "accumulator" ? computeAccumulatorDraftOdds(
      bet.legs.map((leg) => ({
        raceId: leg.raceId,
        selectionName: leg.selectionName,
        decimalOdds: leg.decimalOdds,
        horseUid: leg.horseUid,
      })),
    ) : null
    const resolvedOdds = resolveBetOddsUsed(bet)

    setDraft({
      userId: bet.userId,
      betType: bet.betType,
      betName: bet.betName ?? "",
      stakeTotal: bet.stakeTotal,
      isFreeBet: bet.isFreeBet ?? false,
      oddsUsed: resolvedOdds,
      ewTerms: bet.ewTerms,
      legs:
        bet.betType === "other"
          ? []
          : bet.legs.map((leg) => ({
              raceId: leg.raceId,
              selectionName: leg.selectionName,
              decimalOdds: leg.decimalOdds,
              horseUid: leg.horseUid,
            })),
    })
    setStakeInput(formatStakeInput(bet.stakeTotal))
    setPlacesPaidInput(String(bet.ewTerms?.placesPaid ?? 3))
    setPlaceFractionInput(String(bet.ewTerms?.placeFraction ?? 0.2))
    setAccaOddsManuallySet(
      bet.betType === "accumulator" &&
        isValidOdds(resolvedOdds) &&
        (!isValidOdds(computedAccaOdds) || Math.abs(Number(resolvedOdds) - Number(computedAccaOdds)) > 0.0001),
    )
  }

  const racesByDay = useMemo(() => {
    const grouped: Record<RaceDay, Race[]> = {
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
    }
    racesSorted.forEach((race) => {
      grouped[race.day].push(race)
    })
    return grouped
  }, [racesSorted])
  const raceMap = useMemo(() => new Map(racesSorted.map((race) => [race.id, race])), [racesSorted])
  const retroactiveLegs = useMemo(() => {
    if (draft.betType === "other") {
      return []
    }

    const now = Date.now()
    return draft.legs
      .map((leg, index) => {
        const race = raceMap.get(leg.raceId)
        if (!race || new Date(race.offTime).getTime() > now) {
          return null
        }

        return {
          index,
          race,
          isComplete: race.lifecycle === "complete",
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  }, [draft.betType, draft.legs, raceMap])
  const retroactiveWarning = useMemo(() => {
    if (retroactiveLegs.length === 0) {
      return null
    }

    if (retroactiveLegs.length === 1) {
      return retroactiveLegs[0].isComplete
        ? "This race has already finished. Saving will create a retroactive toot and auto-resolve it from the recorded result."
        : "This race has already started. Saving will create a retroactive toot."
    }

    const completedCount = retroactiveLegs.filter((entry) => entry.isComplete).length
    if (completedCount === retroactiveLegs.length) {
      return "Some selected races have already finished. Saving will create a retroactive toot and auto-resolve any completed legs from the recorded results."
    }

    if (completedCount > 0) {
      return "Some selected races have already started or finished. Saving will create a retroactive toot, and any completed legs will auto-resolve from the recorded results."
    }

    return "Some selected races have already started. Saving will create a retroactive toot."
  }, [retroactiveLegs])
  const autoAccumulatorOdds = useMemo(() => computeAccumulatorDraftOdds(draft.legs), [draft.legs])
  const visibleOpenBets = useMemo(
    () => (showAllOpenBets ? currentOpenBets : currentOpenBets.slice(0, 8)),
    [currentOpenBets, showAllOpenBets],
  )
  const requiredOdds = draft.betType === "accumulator" ? draft.oddsUsed : draft.legs[0]?.decimalOdds
  const hasMissingOdds = draft.betType === "other" ? false : !isValidOdds(requiredOdds)
  const hasMissingOtherName = draft.betType === "other" && !draft.betName?.trim()

  // Compute potential win for display
  const potentialWinDisplay = useMemo(() => {
    const parsedStake = stakeInput.trim() === "" ? draft.stakeTotal : Number(stakeInput)
    if (!Number.isFinite(parsedStake) || parsedStake <= 0) return null
    const draftForDisplay: Bet = {
      id: "__draft__",
      season: "2026",
      userId: draft.userId,
      betType: draft.betType,
      betName: draft.betName,
      oddsUsed: draft.oddsUsed ?? undefined,
      legs:
        draft.betType === "other"
          ? [{ raceId: "__other__", selectionName: draft.betName ?? "Other bet", decimalOdds: draft.oddsUsed ?? 1, result: "pending" }]
          : draft.legs.map((leg) => ({
              raceId: leg.raceId,
              selectionName: leg.selectionName,
              decimalOdds: leg.decimalOdds ?? 0,
              horseUid: leg.horseUid,
              result: "pending",
            })),
      legRaceIds: draft.legs.map((leg) => leg.raceId),
      stakeTotal: parsedStake,
      isFreeBet: draft.isFreeBet ?? false,
      ewTerms: draft.ewTerms,
      lockAt: new Date().toISOString(),
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const win = calculateBetPotentialProfit(draftForDisplay)
    if (win <= 0) return null

    if (draft.betType === "each_way" && draft.ewTerms) {
      const odds = draft.oddsUsed ?? draft.legs[0]?.decimalOdds
      if (!isValidOdds(odds)) {
        return { win, place: null, loss: getBetRiskStake(draftForDisplay) }
      }
      const placeOdds = 1 + (Number(odds) - 1) * draft.ewTerms.placeFraction
      const placeDraft: Bet = {
        ...draftForDisplay,
        betType: "single",
        oddsUsed: placeOdds,
        legs: draftForDisplay.legs.map((leg) => ({ ...leg, decimalOdds: placeOdds })),
      }
      return { win, place: calculateBetPotentialProfit(placeDraft), loss: getBetRiskStake(draftForDisplay) }
    }

    return { win, place: null, loss: getBetRiskStake(draftForDisplay) }
  }, [draft, stakeInput])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setActionError(null)
    const parsedStakeTotal = stakeInput.trim() === "" ? draft.stakeTotal : Number(stakeInput)
    if (!Number.isFinite(parsedStakeTotal) || parsedStakeTotal <= 0) {
      setActionError("Stake must be greater than £0.00.")
      return
    }
    if (hasMissingOtherName) {
      setActionError("Add a name for this other bet before submitting.")
      return
    }
    if (hasMissingOdds) {
      setActionError(
        draft.betType === "accumulator"
          ? "Enter final accumulator decimal odds before submitting."
          : "Enter decimal odds before submitting.",
      )
      return
    }
    setSubmitting(true)

    try {
      const trimmedBetName = draft.betName?.trim()
      const payload: BetDraftForm = {
        ...draft,
        stakeTotal: parsedStakeTotal,
        isFreeBet: draft.isFreeBet ?? false,
        betName: draft.betType === "other" ? trimmedBetName : undefined,
        oddsUsed:
          draft.betType === "other"
            ? null
            : draft.betType === "accumulator"
            ? Number(draft.oddsUsed)
            : Number(draft.legs[0]?.decimalOdds ?? draft.oddsUsed ?? NaN),
        legs:
          draft.betType === "other"
            ? []
            : draft.legs.map((leg) => ({
                ...leg,
                decimalOdds: leg.decimalOdds ?? null,
              })),
      }
      if (editingBetId) {
        const currentBet = bets.find((bet) => bet.id === editingBetId)
        if (!currentBet) {
          throw new Error("Cannot find the bet being edited")
        }
        await onUpdateBet(editingBetId, payload, currentBet)
      } else {
        await onCreateBet(payload)
      }

      resetDraft(payload.userId)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to save bet")
    } finally {
      setSubmitting(false)
    }
  }

  const handleBetTypeChange = (value: BetType) => {
    setAccaOddsManuallySet(false)
    setDraft((prev) => {
      const fallbackLeg = {
        raceId: "",
        selectionName: "",
        decimalOdds: null,
        horseUid: undefined,
      }
      const firstUsableLeg = prev.legs[0] && prev.legs[0].raceId !== "__other__" ? prev.legs[0] : fallbackLeg
      const nextLegs =
        value === "accumulator"
          ? prev.legs
          : value === "other"
            ? []
            : [firstUsableLeg]
      const nextOddsUsed = value === "accumulator" ? computeAccumulatorDraftOdds(nextLegs) : nextLegs[0]?.decimalOdds ?? null
      return {
        ...prev,
        betType: value,
        legs: nextLegs,
        oddsUsed: nextOddsUsed,
        betName: value === "other" ? prev.betName ?? "" : "",
      }
    })
  }

  const raceTimeLabel = (offTime: string) => formatIso(offTime, "HH:mm")

  const setLegRace = (index: number, raceId: string) => {
    const selectedRace = raceMap.get(raceId)
    setDraft((prev) => {
      const nextLegs = prev.legs.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              raceId,
              selectionName: "",
              decimalOdds: null,
              horseUid: undefined,
            }
          : entry,
      )
      return {
        ...prev,
        legs: nextLegs,
        oddsUsed:
          prev.betType === "accumulator" && !accaOddsManuallySet
            ? computeAccumulatorDraftOdds(nextLegs)
            : prev.oddsUsed,
      }
    })
    setQuickRacePicks((prev) => ({
      ...prev,
      [index]: selectedRace
        ? { day: selectedRace.day, time: raceTimeLabel(selectedRace.offTime) }
        : { day: prev[index]?.day, time: undefined },
    }))
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle className="text-base font-bold">
            {editingBetId ? "Edit Bet" : "Have a toot"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Bet type chip selector */}
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Bet Type</Label>
              <div className="chip-group">
                {BET_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="chip"
                    data-active={draft.betType === option.value}
                    onClick={() => handleBetTypeChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {draft.betType === "other" ? (
              <div className="space-y-1.5">
                <Label htmlFor="other-bet-name">Bet Name</Label>
                <Input
                  id="other-bet-name"
                  value={draft.betName ?? ""}
                  placeholder="e.g. Footy + racing weekend acca"
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      betName: event.target.value,
                    }))
                  }
                />
                <div className="text-xs text-muted-foreground">
                  Settle this manually later from My Toots.
                </div>
              </div>
            ) : null}

            {draft.betType !== "other" ? (
              <div className="space-y-4">
                {draft.legs.map((leg, index) => {
                const race = raceMap.get(leg.raceId)
                const quickPick = quickRacePicks[index]
                const selectedDay = quickPick?.day ?? race?.day
                const selectedTime = quickPick?.time ?? (race ? raceTimeLabel(race.offTime) : undefined)
                const dayRaces = selectedDay ? racesByDay[selectedDay] : []
                const dayTimes = [...new Set(dayRaces.map((entry) => raceTimeLabel(entry.offTime)))]
                const horseOptions = (
                  race?.runnersDetailed?.filter((runner) => !runner.nonRunner).map((runner) => ({
                    horseName: runner.horseName,
                    horseUid: runner.horseUid,
                    marketOdds: findMarketDecimalOdds(race, runner.horseName, runner.horseUid),
                  })) ??
                  race?.runners.map((horseName) => ({
                    horseName,
                    horseUid: undefined,
                    marketOdds: findMarketDecimalOdds(race, horseName),
                  })) ??
                  []
                )
                  .slice()
                  .sort((a, b) => {
                    const aOdds = typeof a.marketOdds === "number" ? a.marketOdds : Number.POSITIVE_INFINITY
                    const bOdds = typeof b.marketOdds === "number" ? b.marketOdds : Number.POSITIVE_INFINITY

                    if (aOdds !== bOdds) {
                      return aOdds - bOdds
                    }

                    return a.horseName.localeCompare(b.horseName)
                  })
                const datalistId = `runners-${index}`

                  return (
                    <div key={`${index}-${leg.raceId}`} className="space-y-3">
                    {draft.betType === "accumulator" && draft.legs.length > 1 ? (
                      <div className="flex items-center gap-2">
                        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/15 text-[10px] font-bold text-primary">
                          {index + 1}
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">Leg {index + 1}</span>
                        {draft.legs.length > 2 ? (
                          <button
                            type="button"
                            className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setDraft((prev) => ({
                                ...prev,
                                legs: prev.legs.filter((_, i) => i !== index),
                              }))
                            }}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Day quick picks */}
                    <div className="flex flex-wrap gap-1.5">
                      {dayOrder.map((day) => (
                        <button
                          key={`${index}-${day}`}
                          type="button"
                          className="quick-pick"
                          data-active={selectedDay === day}
                          onClick={() => {
                            setLegRace(index, "")
                            setQuickRacePicks((prev) => ({
                              ...prev,
                              [index]: { day, time: undefined },
                            }))
                          }}
                        >
                          {day.slice(0, 3)}
                        </button>
                      ))}
                    </div>

                    {/* Time quick picks */}
                    {selectedDay ? (
                      <div className="flex flex-wrap gap-1.5">
                        {dayTimes.map((timeToken) => (
                          <button
                            key={`${index}-${selectedDay}-${timeToken}`}
                            type="button"
                            className="quick-pick"
                            data-active={selectedTime === timeToken}
                            onClick={() => {
                              const targetRace = dayRaces.find(
                                (entry) => raceTimeLabel(entry.offTime) === timeToken,
                              )
                              if (!targetRace) {
                                return
                              }
                              setLegRace(index, targetRace.id)
                            }}
                          >
                            {timeToken}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {/* Race + Selection + Odds row */}
                    <div className={cn(
                      "grid gap-3",
                      draft.betType === "accumulator" ? "md:grid-cols-2" : "md:grid-cols-3",
                    )}>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-xs text-muted-foreground">Race</Label>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5 text-sm">
                          {race ? (
                            <div className="font-medium">{race.name}</div>
                          ) : selectedDay ? (
                            <div className="text-muted-foreground">Pick a time pill above to choose the race.</div>
                          ) : (
                            <div className="text-muted-foreground">Pick a day pill, then a time pill above.</div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={`selection-${index}`} className="text-xs text-muted-foreground">Horse</Label>
                        <select
                          id={`selection-${index}`}
                          className="native-select"
                          value={leg.selectionName}
                          disabled={!race}
                          onChange={(event) => {
                            const value = event.target.value
                            const matchedRunner = race?.runnersDetailed?.find(
                              (runner) =>
                                !runner.nonRunner &&
                                normalizeHorseName(runner.horseName) === normalizeHorseName(value),
                            )
                            const marketOdds = findMarketDecimalOdds(race, value, matchedRunner?.horseUid)
                            setDraft((prev) => {
                              const nextLegs = prev.legs.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? {
                                      ...entry,
                                      selectionName: value,
                                      decimalOdds: marketOdds,
                                      horseUid: matchedRunner?.horseUid,
                                    }
                                  : entry,
                              )
                              return {
                                ...prev,
                                legs: nextLegs,
                                oddsUsed:
                                  prev.betType === "accumulator" && !accaOddsManuallySet
                                    ? computeAccumulatorDraftOdds(nextLegs)
                                    : prev.oddsUsed,
                              }
                            })
                          }}
                        >
                          <option value="">{race ? "Select horse" : "Pick race first"}</option>
                          {horseOptions.map((horse) => (
                            <option key={`${datalistId}-${horse.horseName}`} value={horse.horseName}>
                              {horse.marketOdds ? `${horse.horseName} - ${formatOdds(horse.marketOdds)}` : horse.horseName}
                            </option>
                          ))}
                        </select>
                      </div>

                      {draft.betType !== "accumulator" ? (
                        <div className="space-y-1.5">
                          <Label htmlFor={`odds-${index}`} className="text-xs text-muted-foreground">Decimal Odds</Label>
                          <Input
                            id={`odds-${index}`}
                            type="number"
                            min={1}
                            step={0.01}
                            required
                            value={leg.decimalOdds ?? ""}
                            placeholder="e.g. 4.50"
                            onChange={(event) => {
                              const rawValue = event.target.value
                              const value = rawValue === "" ? null : Number(rawValue)
                              setDraft((prev) => ({
                                ...prev,
                                oddsUsed: value,
                                legs: prev.legs.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, decimalOdds: value } : entry,
                                ),
                              }))
                            }}
                          />
                        </div>
                      ) : null}
                    </div>

                    {/* Contextual info */}
                    {race?.lifecycle === "complete" ? (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        <AlertCircle className="size-3.5 shrink-0" />
                        This race has already finished. Saving will create a retroactive toot and auto-resolve it immediately.
                      </div>
                    ) : race && new Date(race.offTime).getTime() <= Date.now() ? (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        <AlertCircle className="size-3.5 shrink-0" />
                        This race has already started. You can still save it as a retroactive toot.
                      </div>
                    ) : null}

                    {leg.selectionName.trim() && leg.decimalOdds === null ? (
                      <div className="text-xs text-muted-foreground">
                        No market odds detected.
                        {draft.betType === "accumulator"
                          ? " Enter final acca odds manually below."
                          : " Enter your placed odds manually."}
                      </div>
                    ) : null}

                    </div>
                  )
                })}

                {draft.betType === "accumulator" ? (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
                    onClick={() => {
                      setDraft((prev) => ({
                        ...prev,
                        oddsUsed: !accaOddsManuallySet ? null : prev.oddsUsed,
                        legs: [
                          ...prev.legs,
                          buildEmptyLeg(nextRace),
                        ],
                      }))
                      setQuickRacePicks((prev) => ({
                        ...prev,
                        [draft.legs.length]: buildQuickPickForRace(nextRace),
                      }))
                    }}
                  >
                    <Plus className="size-4" />
                    Add Leg
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* Stake + Odds row */}
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="stake" className="text-xs text-muted-foreground">Stake</Label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                    <Input
                      id="stake"
                      type="text"
                      inputMode="decimal"
                      className="pl-7"
                    value={stakeInput}
                    placeholder="5.00"
                    onChange={(event) => {
                      const rawValue = event.target.value
                      setStakeInput(rawValue)
                      const parsed = Number(rawValue)
                      if (rawValue !== "" && Number.isFinite(parsed)) {
                        setDraft((prev) => ({
                          ...prev,
                          stakeTotal: parsed,
                        }))
                      }
                    }}
                    onBlur={() => {
                      if (stakeInput.trim() === "") {
                        return
                      }
                      const parsed = Number(stakeInput)
                      if (Number.isFinite(parsed)) {
                        setStakeInput(formatStakeInput(parsed))
                      }
                    }}
                    />
                  </div>
                  <button
                    type="button"
                    aria-pressed={draft.isFreeBet ?? false}
                    title="Free Bet"
                    className={cn(
                      "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                      draft.isFreeBet
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border/50 bg-muted/10 text-muted-foreground hover:bg-muted/20 hover:text-foreground",
                    )}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        isFreeBet: !(prev.isFreeBet ?? false),
                      }))
                    }
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                        draft.isFreeBet
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/70 bg-background/40 text-transparent",
                      )}
                    >
                      <Check className="size-2.5" />
                    </span>
                    Free Bet
                  </button>
                </div>
              </div>

              {draft.betType === "accumulator" ? (
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="acca-odds" className="text-xs text-muted-foreground">Final Acca Odds (Decimal)</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="acca-odds"
                      type="number"
                      min={1}
                      step={0.01}
                      required
                      value={draft.oddsUsed ?? ""}
                      placeholder="e.g. 25.00"
                      onChange={(event) => {
                        const rawValue = event.target.value
                        const value = rawValue === "" ? null : Number(rawValue)
                        setAccaOddsManuallySet(true)
                        setDraft((prev) => ({
                          ...prev,
                          oddsUsed: value,
                        }))
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAccaOddsManuallySet(false)
                        setDraft((prev) => ({
                          ...prev,
                          oddsUsed: autoAccumulatorOdds,
                        }))
                      }}
                    >
                      Auto
                    </Button>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {isValidOdds(autoAccumulatorOdds)
                      ? `Computed from selections: ${formatOdds(autoAccumulatorOdds)}`
                      : "Select all horses to auto-compute."}
                  </div>
                </div>
              ) : null}

              {draft.betType === "each_way" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="places-paid" className="text-xs text-muted-foreground">Places Paid</Label>
                    <Input
                      id="places-paid"
                      type="number"
                      min={1}
                      step={1}
                      value={placesPaidInput}
                      onChange={(event) => {
                        const rawValue = event.target.value
                        setPlacesPaidInput(rawValue)
                        if (rawValue === "") {
                          return
                        }
                        const parsed = Number(rawValue)
                        if (Number.isFinite(parsed)) {
                          setDraft((prev) => ({
                            ...prev,
                            ewTerms: {
                              placesPaid: parsed,
                              placeFraction: prev.ewTerms?.placeFraction ?? 0.2,
                            },
                          }))
                        }
                      }}
                      onBlur={() => {
                        if (placesPaidInput.trim() === "") {
                          const fallback = draft.ewTerms?.placesPaid ?? 3
                          setPlacesPaidInput(String(fallback))
                          return
                        }
                        const parsed = Number(placesPaidInput)
                        if (Number.isFinite(parsed)) {
                          const normalized = Math.max(1, Math.round(parsed))
                          setPlacesPaidInput(String(normalized))
                          setDraft((prev) => ({
                            ...prev,
                            ewTerms: {
                              placesPaid: normalized,
                              placeFraction: prev.ewTerms?.placeFraction ?? 0.2,
                            },
                          }))
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="place-fraction" className="text-xs text-muted-foreground">Place Fraction</Label>
                    <Input
                      id="place-fraction"
                      type="number"
                      min={0.01}
                      max={1}
                      step={0.01}
                      value={placeFractionInput}
                      onChange={(event) => {
                        const rawValue = event.target.value
                        setPlaceFractionInput(rawValue)
                        if (rawValue === "") {
                          return
                        }
                        const parsed = Number(rawValue)
                        if (Number.isFinite(parsed)) {
                          setDraft((prev) => ({
                            ...prev,
                            ewTerms: {
                              placesPaid: prev.ewTerms?.placesPaid ?? 3,
                              placeFraction: parsed,
                            },
                          }))
                        }
                      }}
                      onBlur={() => {
                        if (placeFractionInput.trim() === "") {
                          const fallback = draft.ewTerms?.placeFraction ?? 0.2
                          setPlaceFractionInput(String(fallback))
                          return
                        }
                        const parsed = Number(placeFractionInput)
                        if (Number.isFinite(parsed)) {
                          const normalized = Math.min(1, Math.max(0.01, parsed))
                          setPlaceFractionInput(String(normalized))
                          setDraft((prev) => ({
                            ...prev,
                            ewTerms: {
                              placesPaid: prev.ewTerms?.placesPaid ?? 3,
                              placeFraction: normalized,
                            },
                          }))
                        }
                      }}
                    />
                  </div>
                </>
              ) : null}
            </div>

            {/* Potential win callout */}
            {potentialWinDisplay && potentialWinDisplay.win > 0 ? (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Potential Win
                  </span>
                  <span className="text-lg font-bold text-primary">
                    {formatCurrency(potentialWinDisplay.win)}
                  </span>
                </div>
                {potentialWinDisplay.place !== null ? (
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-[11px] text-muted-foreground">Place only</span>
                    <span className="text-sm font-semibold text-muted-foreground">
                      {formatCurrency(potentialWinDisplay.place)}
                    </span>
                  </div>
                ) : null}
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-[11px] text-muted-foreground">Potential Loss</span>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {formatCurrency(potentialWinDisplay.loss)}
                  </span>
                </div>
              </div>
            ) : null}

            {retroactiveWarning ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                <AlertCircle className="size-4 shrink-0" />
                {retroactiveWarning}
              </div>
            ) : null}

            {actionError ? (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                {actionError}
              </div>
            ) : null}

            {/* Submit row */}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={submitting || hasMissingOdds || hasMissingOtherName}
                className="min-w-[120px]"
              >
                {submitting ? "Saving..." : editingBetId ? "Update Bet" : "Submit toot"}
              </Button>
              {editingBetId ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => resetDraft(selectedUserId)}
                >
                  Cancel
                </Button>
              ) : null}
              {hasMissingOdds && !actionError ? (
                <span className="text-xs text-muted-foreground">
                  {draft.betType === "accumulator" ? "Final odds required" : "Odds required"}
                </span>
              ) : null}
              {hasMissingOtherName && !actionError ? (
                <span className="text-xs text-muted-foreground">Bet name required</span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Open Toots */}
      {currentOpenBets.length > 0 ? (
        <Card className="shadow-xs">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold">Open Toots</CardTitle>
              {currentOpenBets.length > 8 ? (
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setShowAllOpenBets((prev) => !prev)}
                >
                  {showAllOpenBets ? "Show less" : `Show all ${currentOpenBets.length}`}
                </button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleOpenBets.map((bet) => {
              const oddsUsed = resolveBetOddsUsed(bet)
              const potentialWin = calculateBetPotentialProfit(bet)
              const betLabel =
                bet.betType === "other"
                  ? (bet.betName?.trim() || "Other bet")
                  : bet.legs.map((leg) => leg.selectionName).join(" + ")

              return (
                <div key={bet.id} className="bet-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{betLabel}</span>
                        <StatusBadge status={bet.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{bet.betType}</span>
                        <span>{formatCurrency(bet.stakeTotal)}</span>
                        {bet.isFreeBet ? <span>Free bet</span> : null}
                        {oddsUsed ? <span>@ {formatOdds(oddsUsed)}</span> : null}
                        <ChevronRight className="size-3" />
                        <span className="font-medium text-foreground">{formatCurrency(potentialWin)}</span>
                      </div>
                      {bet.betType === "other" ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">Settle from My Toots</div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          Locks {formatIso(bet.lockAt, "EEE HH:mm")}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                        onClick={() => hydrateFromBet(bet)}
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={async () => {
                          setActionError(null)
                          try {
                            await onDeleteBet(bet)
                          } catch (error) {
                            setActionError(
                              error instanceof Error ? error.message : "Failed to delete bet",
                            )
                          }
                        }}
                        title="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
