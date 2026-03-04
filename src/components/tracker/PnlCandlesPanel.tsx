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
import historicalCsvRaw from "../../../data/historical.csv?raw"

type CandlePoint = {
  label: string
  raceName: string
  open: number
  close: number
  high: number
  low: number
  traceA: number
  traceB: number
  wickBase: number
  wickRange: number
  bullBase: number
  bullRange: number
  bearBase: number
  bearRange: number
  traceAShift: number
  traceBShift: number
}

type OffChartTag = {
  year: string
  value: number
}

type HistoricalTraceData = {
  traceAYear: string
  traceBYear: string
  valuesA: number[]
  valuesB: number[]
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

function parseCurrencyToNumber(value: string): number | null {
  const normalized = value.replace(/[^0-9.-]/g, "")
  if (!normalized) {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseHistoricalTraces(rawCsv: string): HistoricalTraceData | null {
  const lines = rawCsv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) {
    return null
  }

  const headers = lines[0].split(",").map((value) => value.trim())
  const yearColumns = headers
    .map((header, index) => ({ header, index }))
    .filter((entry) => /^\d{4}$/.test(entry.header))
  if (yearColumns.length === 0) {
    return null
  }

  const selected = yearColumns.slice(-2)
  const primary = selected[0]
  const secondary = selected[1] ?? selected[0]
  const valuesA: number[] = []
  const valuesB: number[] = []

  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((value) => value.trim())
    const timeToken = cols[2]?.toLowerCase() ?? ""
    if (timeToken === "other") {
      continue
    }

    const first = parseCurrencyToNumber(cols[primary.index] ?? "")
    const second = parseCurrencyToNumber(cols[secondary.index] ?? "")
    if (first === null || second === null) {
      continue
    }
    valuesA.push(first)
    valuesB.push(second)
  }

  if (valuesA.length === 0 || valuesB.length === 0) {
    return null
  }

  return {
    traceAYear: primary.header,
    traceBYear: secondary.header,
    valuesA,
    valuesB,
  }
}

const HISTORICAL_TRACES = parseHistoricalTraces(historicalCsvRaw)

function buildCandleData(
  races: Race[],
  bets: Bet[],
): {
  points: CandlePoint[]
  shiftOffset: number
  traceAYear: string
  traceBYear: string
  yDomainMin: number
  yDomainMax: number
  offChartTags: OffChartTag[]
} {
  const settledRaces = races
    .filter((race) => race.status === "settled")
    .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())

  if (!settledRaces.length) {
    return {
      points: [],
      shiftOffset: 0,
      traceAYear: HISTORICAL_TRACES?.traceAYear ?? "Prev A",
      traceBYear: HISTORICAL_TRACES?.traceBYear ?? "Prev B",
      yDomainMin: 0,
      yDomainMax: 0,
      offChartTags: [],
    }
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

    const traceA =
      HISTORICAL_TRACES?.valuesA[index] ??
      Number((close * 0.82 + Math.sin(index * 0.75) * 42 - 55).toFixed(2))
    const traceB =
      HISTORICAL_TRACES?.valuesB[index] ??
      Number((close * 1.06 + Math.cos(index * 0.65) * 35 + 35).toFixed(2))

    cumulative = close

    return {
      label: formatIso(race.offTime, "EEE HH:mm"),
      raceName: race.name,
      open,
      close,
      high,
      low,
      traceA,
      traceB,
    }
  })

  const currentMin = Math.min(0, ...raw.map((point) => point.low))
  const currentMax = Math.max(0, ...raw.map((point) => point.high))
  const shiftOffset = Math.abs(currentMin) + 20
  const yDomainMin = 0
  const yDomainMax = currentMax + shiftOffset + 20

  const points: CandlePoint[] = raw.map((point) => ({
    ...point,
    wickBase: point.low + shiftOffset,
    wickRange: point.high - point.low,
    bullBase: point.open + shiftOffset,
    bullRange: Math.max(point.close - point.open, 0),
    bearBase: point.close + shiftOffset,
    bearRange: Math.max(point.open - point.close, 0),
    traceAShift: point.traceA + shiftOffset,
    traceBShift: point.traceB + shiftOffset,
  }))

  return {
    points,
    shiftOffset,
    traceAYear: HISTORICAL_TRACES?.traceAYear ?? "Prev A",
    traceBYear: HISTORICAL_TRACES?.traceBYear ?? "Prev B",
    yDomainMin,
    yDomainMax,
    offChartTags: [
      {
        year: HISTORICAL_TRACES?.traceAYear ?? "Prev A",
        value: Math.max(...raw.map((point) => point.traceA)),
      },
      {
        year: HISTORICAL_TRACES?.traceBYear ?? "Prev B",
        value: Math.max(...raw.map((point) => point.traceB)),
      },
    ]
      .filter((entry, index, arr) => entry.value > currentMax && (index === 0 || entry.year !== arr[0]?.year))
      .sort((a, b) => b.value - a.value),
  }
}

type PnlCandlesPanelProps = {
  bets: Bet[]
  races: Race[]
}

function CandleTooltip(props: {
  active?: boolean
  payload?: Array<{ payload?: CandlePoint }>
  traceAYear: string
  traceBYear: string
}) {
  if (!props.active || !props.payload?.length || !props.payload[0]?.payload) {
    return null
  }

  const point = props.payload[0].payload as CandlePoint
  const change = Number((point.close - point.open).toFixed(2))
  const isUp = change >= 0

  return (
    <div className="max-w-[260px] rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="font-semibold">{point.label}</div>
      <div className="mb-2 text-muted-foreground">{point.raceName}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1">
        <span className="text-muted-foreground">Open</span>
        <span className="text-right">{formatCurrency(point.open)}</span>
        <span className="text-muted-foreground">Close</span>
        <span className="text-right">{formatCurrency(point.close)}</span>
        <span className="text-muted-foreground">Change</span>
        <span className={`text-right ${isUp ? "text-primary" : "text-destructive"}`}>
          {isUp ? "+" : ""}
          {formatCurrency(change)}
        </span>
        <span className="text-muted-foreground">High / Low</span>
        <span className="text-right">
          {formatCurrency(point.high)} / {formatCurrency(point.low)}
        </span>
        <span className="text-muted-foreground">{props.traceAYear} trace</span>
        <span className="text-right">{formatCurrency(point.traceA)}</span>
        {props.traceBYear !== props.traceAYear ? (
          <>
            <span className="text-muted-foreground">{props.traceBYear} trace</span>
            <span className="text-right">{formatCurrency(point.traceB)}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

export function PnlCandlesPanel({ bets, races }: PnlCandlesPanelProps) {
  const candle = buildCandleData(races, bets)

  return (
    <div className="panel-subtle">
      <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Total P&L Candles</div>
      <div className="h-64 min-w-0">
        {candle.points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Candles appear as races are settled.
          </div>
        ) : (
          <div className="relative h-full min-w-0">
            {candle.offChartTags.length ? (
              <div className="pointer-events-none absolute right-2 top-2 z-10 flex max-w-[70%] flex-col gap-1">
                {candle.offChartTags.map((tag) => (
                  <div
                    key={`${tag.year}-${tag.value}`}
                    className="rounded-md border border-border bg-background/90 px-2 py-1 text-[10px] leading-tight text-muted-foreground shadow-md backdrop-blur"
                    title={`${tag.year} historical peak`}
                  >
                    <span className="mr-1 font-medium text-foreground">{tag.year}</span>
                    <span>off-chart: {formatCurrency(tag.value)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <ComposedChart data={candle.points} margin={{ top: 12, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={[candle.yDomainMin, candle.yDomainMax]}
                  allowDataOverflow
                  tickFormatter={(value) => formatCurrency(Number(value) - candle.shiftOffset)}
                />
                <Tooltip
                  cursor={{ stroke: "var(--primary)", strokeOpacity: 0.35, strokeWidth: 1.5 }}
                  content={<CandleTooltip traceAYear={candle.traceAYear} traceBYear={candle.traceBYear} />}
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
                  dataKey="traceAShift"
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.35}
                  strokeWidth={1.5}
                  dot={false}
                />
                {candle.traceBYear !== candle.traceAYear ? (
                  <Line
                    type="monotone"
                    dataKey="traceBShift"
                    stroke="var(--muted-foreground)"
                    strokeOpacity={0.22}
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
