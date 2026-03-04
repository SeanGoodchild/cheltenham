import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatIso } from "@/lib/time"
import type { GlobalStats, Race, RaceDay } from "@/lib/types"

type AdminPanelProps = {
  races: Race[]
  globalStats: GlobalStats | null
  onCreateRace: (input: { day: RaceDay; offTime: string; name: string; runners: string[] }) => Promise<void>
  onUpdateResult: (input: { raceId: string; winner?: string; placed: string[] }) => Promise<void>
  onSettleRace: (raceId: string) => Promise<void>
  onQueueDailySummary: (stats: GlobalStats) => Promise<void>
  onSetImportLock: (input: { raceId: string; locked: boolean; reason?: string }) => Promise<void>
}

export function AdminPanel({
  races,
  globalStats,
  onCreateRace,
  onUpdateResult,
  onSettleRace,
  onQueueDailySummary,
  onSetImportLock,
}: AdminPanelProps) {
  const [raceName, setRaceName] = useState("")
  const [raceDay, setRaceDay] = useState<RaceDay>("Tuesday")
  const [raceOffTime, setRaceOffTime] = useState("")
  const [raceRunners, setRaceRunners] = useState("")

  const [selectedRaceId, setSelectedRaceId] = useState("")
  const [winner, setWinner] = useState("")
  const [placed, setPlaced] = useState("")
  const [lockReason, setLockReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const selectedRace = races.find((race) => race.id === selectedRaceId)

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle>Admin Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="panel-subtle space-y-2">
          <h3 className="text-sm font-medium">Create Race</h3>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="race-name">Race name</Label>
              <Input id="race-name" value={raceName} onChange={(event) => setRaceName(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="race-day">Day</Label>
              <select
                id="race-day"
                className="native-select"
                value={raceDay}
                onChange={(event) => setRaceDay(event.target.value as RaceDay)}
              >
                <option>Tuesday</option>
                <option>Wednesday</option>
                <option>Thursday</option>
                <option>Friday</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="race-off-time">Off time (ISO)</Label>
              <Input
                id="race-off-time"
                placeholder="2026-03-10T13:30:00.000Z"
                value={raceOffTime}
                onChange={(event) => setRaceOffTime(event.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="race-runners">Runners (comma-separated)</Label>
              <Textarea
                id="race-runners"
                value={raceRunners}
                onChange={(event) => setRaceRunners(event.target.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            onClick={async () => {
              setError(null)
              setWorking(true)
              try {
                await onCreateRace({
                  day: raceDay,
                  offTime: raceOffTime,
                  name: raceName,
                  runners: raceRunners.split(",").map((part) => part.trim()),
                })
                setRaceName("")
                setRaceOffTime("")
                setRaceRunners("")
              } catch (createError) {
                setError(createError instanceof Error ? createError.message : "Failed to create race")
              } finally {
                setWorking(false)
              }
            }}
            disabled={working}
          >
            Add Race
          </Button>
        </section>

        <section className="panel-subtle space-y-2">
          <h3 className="text-sm font-medium">Manual Result + Settlement</h3>
          <div className="space-y-1">
            <Label htmlFor="settle-race">Race</Label>
            <select
              id="settle-race"
              value={selectedRaceId}
              className="native-select"
              onChange={(event) => {
                setSelectedRaceId(event.target.value)
                const race = races.find((entry) => entry.id === event.target.value)
                setWinner(race?.result.winner ?? "")
                setPlaced(race?.result.placed.join(", ") ?? "")
                setLockReason(race?.importLock?.reason ?? "")
              }}
            >
              <option value="">Select race</option>
              {races.map((race) => (
                <option key={race.id} value={race.id}>
                  {formatIso(race.offTime, "EEE HH:mm")} - {race.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="winner">Winner</Label>
              <Input id="winner" value={winner} onChange={(event) => setWinner(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="placed">Placed (comma-separated)</Label>
              <Input id="placed" value={placed} onChange={(event) => setPlaced(event.target.value)} />
            </div>
          </div>

          {selectedRace ? (
            <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              Known runners: {selectedRace.runners.join(", ")}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!selectedRaceId || working}
              onClick={async () => {
                setError(null)
                setWorking(true)
                try {
                  await onUpdateResult({
                    raceId: selectedRaceId,
                    winner,
                    placed: placed
                      .split(",")
                      .map((part) => part.trim())
                      .filter(Boolean),
                  })
                } catch (resultError) {
                  setError(resultError instanceof Error ? resultError.message : "Failed to save result")
                } finally {
                  setWorking(false)
                }
              }}
            >
              Save Result
            </Button>
            <Button
              type="button"
              disabled={!selectedRaceId || working}
              onClick={async () => {
                setError(null)
                setWorking(true)
                try {
                  await onSettleRace(selectedRaceId)
                } catch (settleError) {
                  setError(settleError instanceof Error ? settleError.message : "Failed to settle race")
                } finally {
                  setWorking(false)
                }
              }}
            >
              Settle Race
            </Button>
            <Button
              type="button"
              variant={selectedRace?.importLock?.lockedByManualOverride ? "secondary" : "outline"}
              disabled={!selectedRaceId || working}
              onClick={async () => {
                if (!selectedRace) {
                  return
                }

                setError(null)
                setWorking(true)
                try {
                  const nextLocked = !selectedRace.importLock?.lockedByManualOverride
                  await onSetImportLock({
                    raceId: selectedRace.id,
                    locked: nextLocked,
                    reason: nextLocked ? lockReason : undefined,
                  })
                } catch (lockError) {
                  setError(lockError instanceof Error ? lockError.message : "Failed to update import lock")
                } finally {
                  setWorking(false)
                }
              }}
            >
              {selectedRace?.importLock?.lockedByManualOverride
                ? "Unlock race for importer"
                : "Lock race from importer"}
            </Button>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lock-reason">Lock reason</Label>
            <Input
              id="lock-reason"
              placeholder="Manual override in progress"
              value={lockReason}
              onChange={(event) => setLockReason(event.target.value)}
            />
          </div>
          {selectedRace ? (
            <div className="text-xs text-muted-foreground">
              Import lock: {selectedRace.importLock?.lockedByManualOverride ? "enabled" : "disabled"}
            </div>
          ) : null}
        </section>

        <section className="panel-subtle space-y-2">
          <h3 className="text-sm font-medium">Daily Summary Queue</h3>
          <Button
            type="button"
            variant="outline"
            disabled={!globalStats || working}
            onClick={async () => {
              if (!globalStats) {
                return
              }

              setError(null)
              setWorking(true)
              try {
                await onQueueDailySummary(globalStats)
              } catch (summaryError) {
                setError(summaryError instanceof Error ? summaryError.message : "Failed to queue summary")
              } finally {
                setWorking(false)
              }
            }}
          >
            Queue Daily Summary Notification
          </Button>
        </section>

        {error ? <div className="text-sm text-destructive">{error}</div> : null}
      </CardContent>
    </Card>
  )
}
