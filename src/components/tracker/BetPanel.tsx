import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatOdds } from "@/lib/format"
import { normalizeHorseName } from "@/lib/horse"
import { formatIso } from "@/lib/time"
import type { Bet, BetType, Race, RaceDay, UserProfile } from "@/lib/types"

export type BetDraftForm = {
  userId: string
  betType: BetType
  stakeTotal: number
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
  users: UserProfile[]
  races: Race[]
  bets: Bet[]
  selectedUserId: string
  onSelectUserId: (value: string) => void
  onCreateBet: (draft: BetDraftForm) => Promise<void>
  onUpdateBet: (betId: string, draft: BetDraftForm, currentBet: Bet) => Promise<void>
  onDeleteBet: (bet: Bet) => Promise<void>
}

function newDraft(userId: string): BetDraftForm {
  return {
    userId,
    betType: "single",
    stakeTotal: 2,
    ewTerms: {
      placesPaid: 3,
      placeFraction: 0.2,
    },
    legs: [
      {
        raceId: "",
        selectionName: "",
        decimalOdds: null,
        horseUid: undefined,
      },
    ],
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

function lifecycleLabel(value: Race["lifecycle"]): string {
  if (value === "in_progress") {
    return "In Progress"
  }
  if (value === "complete") {
    return "Complete"
  }
  return "Upcoming"
}

export function BetPanel({
  users,
  races,
  bets,
  selectedUserId,
  onSelectUserId,
  onCreateBet,
  onUpdateBet,
  onDeleteBet,
}: BetPanelProps) {
  const dayOrder: RaceDay[] = ["Tuesday", "Wednesday", "Thursday", "Friday"]
  const [draft, setDraft] = useState<BetDraftForm>(() => newDraft(selectedUserId))
  const [editingBetId, setEditingBetId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [quickRacePicks, setQuickRacePicks] = useState<Record<number, { day?: RaceDay; time?: string }>>({})

  const currentOpenBets = useMemo(
    () => bets.filter((bet) => bet.userId === selectedUserId).slice(0, 8),
    [bets, selectedUserId],
  )

  const resetDraft = (userId: string) => {
    setDraft(newDraft(userId))
    setEditingBetId(null)
  }

  const hydrateFromBet = (bet: Bet) => {
    setEditingBetId(bet.id)
    setDraft({
      userId: bet.userId,
      betType: bet.betType,
      stakeTotal: bet.stakeTotal,
      ewTerms: bet.ewTerms,
      legs: bet.legs.map((leg) => ({
        raceId: leg.raceId,
        selectionName: leg.selectionName,
        decimalOdds: leg.decimalOdds,
        horseUid: leg.horseUid,
      })),
    })
  }

  const racesSorted = useMemo(
    () => [...races].sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime()),
    [races],
  )
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
  const hasMissingOdds = useMemo(
    () => draft.legs.some((leg) => !Number.isFinite(leg.decimalOdds ?? NaN) || Number(leg.decimalOdds) < 1),
    [draft.legs],
  )

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setActionError(null)
    if (hasMissingOdds) {
      setActionError("Enter decimal odds for every leg before submitting.")
      return
    }
    setSubmitting(true)

    try {
      const payload: BetDraftForm = {
        ...draft,
        legs: draft.legs.map((leg) => ({
          ...leg,
          decimalOdds: Number(leg.decimalOdds),
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
    setDraft((prev) => {
      const nextLegs = value === "accumulator" ? prev.legs : [prev.legs[0]]
      return {
        ...prev,
        betType: value,
        legs: nextLegs,
      }
    })
  }

  const raceTimeLabel = (offTime: string) => formatIso(offTime, "HH:mm")

  const setLegRace = (index: number, raceId: string) => {
    const selectedRace = raceMap.get(raceId)
    setDraft((prev) => ({
      ...prev,
      legs: prev.legs.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              raceId,
              selectionName: "",
              decimalOdds: null,
              horseUid: undefined,
            }
          : entry,
      ),
    }))
    setQuickRacePicks((prev) => ({
      ...prev,
      [index]: selectedRace
        ? { day: selectedRace.day, time: raceTimeLabel(selectedRace.offTime) }
        : { day: prev[index]?.day, time: undefined },
    }))
  }

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle>Place Bet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="identity">Who Are Ya?</Label>
              <select
                id="identity"
                value={selectedUserId}
                className="native-select"
                onChange={(event) => {
                  onSelectUserId(event.target.value)
                  setDraft((prev) => ({ ...prev, userId: event.target.value }))
                }}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="bet-type">Bet Type</Label>
              <select
                id="bet-type"
                value={draft.betType}
                className="native-select"
                onChange={(event) => handleBetTypeChange(event.target.value as BetType)}
              >
                <option value="single">Single</option>
                <option value="each_way">Each-way</option>
                <option value="accumulator">Accumulator</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            {draft.legs.map((leg, index) => {
              const race = raceMap.get(leg.raceId)
              const quickPick = quickRacePicks[index]
              const selectedDay = quickPick?.day ?? race?.day
              const selectedTime = quickPick?.time ?? (race ? raceTimeLabel(race.offTime) : undefined)
              const dayRaces = selectedDay ? racesByDay[selectedDay] : []
              const dayTimes = [...new Set(dayRaces.map((entry) => raceTimeLabel(entry.offTime)))]
              const horseOptions = (
                race?.runnersDetailed?.filter((runner) => !runner.nonRunner).map((runner) => runner.horseName) ??
                race?.runners ??
                []
              )
                .slice()
                .sort((a, b) => a.localeCompare(b))
              const datalistId = `runners-${index}`

              return (
                <div key={`${index}-${leg.raceId}`} className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {dayOrder.map((day) => (
                      <Button
                        key={`${index}-${day}`}
                        type="button"
                        size="sm"
                        variant={selectedDay === day ? "default" : "outline"}
                        onClick={() => {
                          setQuickRacePicks((prev) => ({
                            ...prev,
                            [index]: { day, time: undefined },
                          }))
                        }}
                      >
                        {day.slice(0, 3)}
                      </Button>
                    ))}
                  </div>
                  {selectedDay ? (
                    <div className="flex flex-wrap gap-2">
                      {dayTimes.map((timeToken) => (
                        <Button
                          key={`${index}-${selectedDay}-${timeToken}`}
                          type="button"
                          size="sm"
                          variant={selectedTime === timeToken ? "default" : "outline"}
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
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor={`race-${index}`}>Race</Label>
                      <select
                        id={`race-${index}`}
                        value={leg.raceId}
                        className="native-select"
                        onChange={(event) => setLegRace(index, event.target.value)}
                      >
                        <option value="">Select race</option>
                        {racesSorted.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {formatIso(entry.offTime, "EEE HH:mm")} - {entry.name} [{lifecycleLabel(entry.lifecycle)}]
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`selection-${index}`}>Selection</Label>
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
                          setDraft((prev) => ({
                            ...prev,
                            legs: prev.legs.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    selectionName: value,
                                    decimalOdds: marketOdds,
                                    horseUid: matchedRunner?.horseUid,
                                  }
                                : entry,
                            ),
                          }))
                        }}
                      >
                        <option value="">{race ? "Select horse" : "Pick race first"}</option>
                        {horseOptions.map((horseName) => (
                          <option key={`${datalistId}-${horseName}`} value={horseName}>
                            {horseName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`odds-${index}`}>Decimal Odds</Label>
                      <Input
                        id={`odds-${index}`}
                        type="number"
                        min={1}
                        step={0.01}
                        required
                        value={leg.decimalOdds ?? ""}
                        placeholder="Required"
                        onChange={(event) => {
                          const rawValue = event.target.value
                          const value = rawValue === "" ? null : Number(rawValue)
                          setDraft((prev) => ({
                            ...prev,
                            legs: prev.legs.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, decimalOdds: value } : entry,
                            ),
                          }))
                        }}
                      />
                    </div>
                  </div>
                  {race?.lifecycle === "complete" ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                      Warning: this race is complete. If a bet is accepted here, it will auto-resolve immediately using
                      the stored result.
                    </div>
                  ) : null}
                  {leg.selectionName.trim() && leg.decimalOdds === null ? (
                    <div className="text-xs text-muted-foreground">
                      No detected market odds for this selection yet. Enter your placed odds manually.
                    </div>
                  ) : null}
                  {race?.marketFavourite ? (
                    <div className="rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                      Market favourite:{" "}
                      <span className="font-medium text-foreground">{race.marketFavourite.horseName}</span>{" "}
                      at {race.marketFavourite.bestFractional} ({formatOdds(race.marketFavourite.bestDecimal)})
                      {race.oddsMeta?.importedAt ? ` • refreshed ${formatIso(race.oddsMeta.importedAt, "EEE HH:mm")}` : ""}
                    </div>
                  ) : null}
                </div>
              )
            })}

            {draft.betType === "accumulator" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraft((prev) => ({
                    ...prev,
                    legs: [
                      ...prev.legs,
                      { raceId: "", selectionName: "", decimalOdds: null, horseUid: undefined },
                    ],
                  }))
                }}
              >
                Add Leg
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="stake">Total Stake (£)</Label>
              <Input
                id="stake"
                type="number"
                min={0.1}
                step={0.1}
                value={draft.stakeTotal}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    stakeTotal: Number(event.target.value),
                  }))
                }
              />
            </div>

            {draft.betType === "each_way" ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="places-paid">Places Paid</Label>
                  <Input
                    id="places-paid"
                    type="number"
                    min={1}
                    step={1}
                    value={draft.ewTerms?.placesPaid ?? 3}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        ewTerms: {
                          placesPaid: Number(event.target.value),
                          placeFraction: prev.ewTerms?.placeFraction ?? 0.2,
                        },
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="place-fraction">Place Fraction (e.g 0.2)</Label>
                  <Input
                    id="place-fraction"
                    type="number"
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={draft.ewTerms?.placeFraction ?? 0.2}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        ewTerms: {
                          placesPaid: prev.ewTerms?.placesPaid ?? 3,
                          placeFraction: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </div>
              </>
            ) : null}
          </div>

          {actionError ? <div className="text-sm text-destructive">{actionError}</div> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={submitting || hasMissingOdds}>
              {editingBetId ? "Update Bet" : "Place Bet"}
            </Button>
            {hasMissingOdds ? (
              <div className="self-center text-xs text-muted-foreground">Decimal odds are required for each leg.</div>
            ) : null}
            {editingBetId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetDraft(selectedUserId)
                }}
              >
                Cancel Edit
              </Button>
            ) : null}
          </div>
        </form>

          <div className="space-y-2">
          <div className="text-sm font-medium">Recent Bets</div>
          {currentOpenBets.length === 0 ? (
            <div className="text-sm text-muted-foreground">No bets yet.</div>
          ) : (
            <div className="space-y-2">
              {currentOpenBets.map((bet) => (
                <div key={bet.id} className="panel-subtle text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{bet.legs.map((leg) => leg.selectionName).join(" + ")}</div>
                      <div className="text-xs text-muted-foreground">
                        {bet.betType} • {formatCurrency(bet.stakeTotal)} • lock {formatIso(bet.lockAt, "EEE HH:mm")}
                      </div>
                    </div>
                    <Badge variant={bet.status === "settled" ? "default" : "secondary"}>{bet.status}</Badge>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => hydrateFromBet(bet)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
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
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
