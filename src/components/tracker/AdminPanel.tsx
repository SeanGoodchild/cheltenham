import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatIso } from "@/lib/time"
import type { Race } from "@/lib/types"

type AdminPanelProps = {
  races: Race[]
  onUpdateResult: (input: { raceId: string; winner?: string; placed: string[] }) => Promise<void>
  onSettleRace: (raceId: string) => Promise<void>
}

export function AdminPanel({ races, onUpdateResult, onSettleRace }: AdminPanelProps) {
  const [selectedRaceId, setSelectedRaceId] = useState("")
  const [winner, setWinner] = useState("")
  const [placed, setPlaced] = useState("")
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
          <h3 className="text-sm font-medium">Edit Race Results + Bet Outcomes</h3>
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
          </div>
        </section>

        {error ? <div className="text-sm text-destructive">{error}</div> : null}
      </CardContent>
    </Card>
  )
}
