import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { formatCurrency } from "@/lib/format"
import { formatIso } from "@/lib/time"
import type { Bet, Race } from "@/lib/types"

type CandlePoint = {
  label: string
  raceName: string
  open: number
  close: number
  high: number
  low: number
  trace2024: number
  trace2025: number
  wickBase: number
  wickRange: number
  bullBase: number
  bullRange: number
  bearBase: number
  bearRange: number
  trace2024Shift: number
  trace2025Shift: number
}

function getSettlementRaceId(bet: Bet, races: Race[]): string | null {
  if (!bet.legs.length) {
    return null
  }

  const legsWithRace = bet.legs
    .map((leg) => ({
      raceId: leg.raceId,
      offTime: races.find((race) => race.id === leg.raceId)?.offTime,
    }))
    .filter((entry): entry is { raceId: string; offTime: string } => Boolean(entry.offTime))

  if (!legsWithRace.length) {
    return null
  }

  return legsWithRace.sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime()).at(-1)?.raceId ?? null
}

function buildCandleData(races: Race[], bets: Bet[]): { points: CandlePoint[]; shiftOffset: number } {
  const settledRaces = races
    .filter((race) => race.status === "settled")
    .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())

  if (!settledRaces.length) {
    return { points: [], shiftOffset: 0 }
  }

  const racePnl = new Map<string, number>()
  bets
    .filter((bet) => bet.status === "settled")
    .forEach((bet) => {
      const settleRaceId = getSettlementRaceId(bet, races)
      if (!settleRaceId) {
        return
      }
      racePnl.set(settleRaceId, (racePnl.get(settleRaceId) ?? 0) + (bet.profitLoss ?? 0))
    })

  let cumulative = 0
  const raw = settledRaces.map((race, index) => {
    const open = cumulative
    const delta = Number((racePnl.get(race.id) ?? 0).toFixed(2))
    const close = Number((open + delta).toFixed(2))
    const wick = Math.max(5, Math.abs(delta) * 0.35)
    const high = Math.max(open, close) + wick
    const low = Math.min(open, close) - wick

    const trace2024 = Number((close * 0.82 + Math.sin(index * 0.75) * 42 - 55).toFixed(2))
    const trace2025 = Number((close * 1.06 + Math.cos(index * 0.65) * 35 + 35).toFixed(2))

    cumulative = close

    return {
      label: formatIso(race.offTime, "EEE HH:mm"),
      raceName: race.name,
      open,
      close,
      high,
      low,
      trace2024,
      trace2025,
    }
  })

  const floor = Math.min(
    0,
    ...raw.map((point) => point.low),
    ...raw.map((point) => point.trace2024),
    ...raw.map((point) => point.trace2025),
  )
  const shiftOffset = Math.abs(floor) + 40

  const points: CandlePoint[] = raw.map((point) => ({
    ...point,
    wickBase: point.low + shiftOffset,
    wickRange: point.high - point.low,
    bullBase: point.open + shiftOffset,
    bullRange: Math.max(point.close - point.open, 0),
    bearBase: point.close + shiftOffset,
    bearRange: Math.max(point.open - point.close, 0),
    trace2024Shift: point.trace2024 + shiftOffset,
    trace2025Shift: point.trace2025 + shiftOffset,
  }))

  return { points, shiftOffset }
}

type PnlCandlesPanelProps = {
  bets: Bet[]
  races: Race[]
}

export function PnlCandlesPanel({ bets, races }: PnlCandlesPanelProps) {
  const candle = buildCandleData(races, bets)

  return (
    <div className="panel-subtle">
      <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Total P&L Candles</div>
      <div className="h-64">
        {candle.points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Candles appear as races are settled.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={candle.points} margin={{ top: 12, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(value) => formatCurrency(Number(value) - candle.shiftOffset)}
              />
              <Tooltip
                formatter={(value, name, item) => {
                  if (!item?.payload) {
                    return [String(value), String(name)]
                  }

                  const payload = item.payload as CandlePoint
                  if (name === "trace2024Shift") {
                    return [formatCurrency(payload.trace2024), "2024 trace"]
                  }
                  if (name === "trace2025Shift") {
                    return [formatCurrency(payload.trace2025), "2025 trace"]
                  }

                  return [formatCurrency(Number(value) - candle.shiftOffset), String(name)]
                }}
                labelFormatter={(_, entries) => {
                  const payload = entries?.[0]?.payload as CandlePoint | undefined
                  if (!payload) {
                    return ""
                  }
                  return `${payload.label} • ${payload.raceName}`
                }}
              />

              <Bar dataKey="wickBase" stackId="wick" fill="transparent" barSize={2} isAnimationActive={false} />
              <Bar
                dataKey="wickRange"
                stackId="wick"
                fill="var(--muted-foreground)"
                opacity={0.35}
                barSize={2}
                isAnimationActive={false}
              />

              <Bar dataKey="bullBase" stackId="bull" fill="transparent" barSize={12} isAnimationActive={false} />
              <Bar dataKey="bullRange" stackId="bull" barSize={12} isAnimationActive={false}>
                {candle.points.map((entry) => (
                  <Cell key={`bull-${entry.label}`} fill={entry.bullRange > 0 ? "var(--primary)" : "transparent"} />
                ))}
              </Bar>

              <Bar dataKey="bearBase" stackId="bear" fill="transparent" barSize={12} isAnimationActive={false} />
              <Bar dataKey="bearRange" stackId="bear" barSize={12} isAnimationActive={false}>
                {candle.points.map((entry) => (
                  <Cell key={`bear-${entry.label}`} fill={entry.bearRange > 0 ? "var(--destructive)" : "transparent"} />
                ))}
              </Bar>

              <Line
                type="monotone"
                dataKey="trace2024Shift"
                stroke="var(--muted-foreground)"
                strokeOpacity={0.35}
                strokeWidth={1.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="trace2025Shift"
                stroke="var(--muted-foreground)"
                strokeOpacity={0.22}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
