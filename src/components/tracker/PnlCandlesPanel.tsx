import { useLayoutEffect, useRef, useState } from "react"
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { formatCurrency } from "@/lib/format"
import type { RacePnlRange } from "@/lib/settlement"
import { formatIso } from "@/lib/time"

type CandlePoint = {
  label: string
  raceName: string
  open: number
  close: number
  high: number
  low: number
  bodyBase: number
  bodyRange: number
  bodyTone: "up" | "down" | "flat"
}

function buildCandleData(
  raceRanges: RacePnlRange[],
): {
  points: CandlePoint[]
  shiftOffset: number
  yDomainMin: number
  yDomainMax: number
} {
  const settledRanges = raceRanges.filter((range) => !range.isForecast && typeof range.actualClosePnl === "number")

  if (!settledRanges.length) {
    return {
      points: [],
      shiftOffset: 0,
      yDomainMin: 0,
      yDomainMax: 0,
    }
  }

  const raw = settledRanges.map((range) => {
    const open = range.openPnl
    const close = range.actualClosePnl ?? open
    const isFlat = Math.abs(close - open) < 0.005
    const high = isFlat ? close + 1.25 : Math.max(open, close)
    const low = isFlat ? close - 1.25 : Math.min(open, close)

    return {
      label: formatIso(range.offTime, "EEE HH:mm"),
      raceName: range.raceName,
      open,
      close,
      high,
      low,
      isFlat,
    }
  })

  const currentMin = Math.min(...raw.map((point) => point.low))
  const currentMax = Math.max(...raw.map((point) => point.high))
  const currentRange = Math.max(currentMax - currentMin, 1)
  const yPadding = Math.max(currentRange * 0.16, 12)
  const domainMinUnshifted = currentMin - yPadding
  const domainMaxUnshifted = currentMax + yPadding
  const shiftOffset = Math.abs(Math.min(domainMinUnshifted, 0)) + yPadding
  const yDomainMin = domainMinUnshifted + shiftOffset
  const yDomainMax = domainMaxUnshifted + shiftOffset

  const points: CandlePoint[] = raw.map((point) => ({
    ...point,
    bodyBase: point.low + shiftOffset,
    bodyRange: point.high - point.low,
    bodyTone: point.isFlat ? "flat" : point.close > point.open ? "up" : "down",
  }))

  return {
    points,
    shiftOffset,
    yDomainMin,
    yDomainMax,
  }
}

type PnlCandlesPanelProps = {
  raceRanges: RacePnlRange[]
}

function CandleTooltip(props: {
  active?: boolean
  payload?: Array<{ payload?: CandlePoint }>
}) {
  if (!props.active || !props.payload?.length || !props.payload[0]?.payload) {
    return null
  }

  const point = props.payload[0].payload as CandlePoint
  const change = Number((point.close - point.open).toFixed(2))
  const changeClass = change > 0 ? "text-primary" : change < 0 ? "text-destructive" : "text-muted-foreground"
  const changePrefix = change > 0 ? "+" : ""

  return (
    <div className="max-w-[240px] rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-xs shadow-2xl">
      <div className="font-bold">{point.label}</div>
      <div className="mb-2 text-[11px] text-muted-foreground">{point.raceName}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Open</span>
        <span className="text-right tabular-nums">{formatCurrency(point.open)}</span>
        <span className="text-muted-foreground">Close</span>
        <span className="text-right tabular-nums">{formatCurrency(point.close)}</span>
        <span className="text-muted-foreground">Change</span>
        <span className={`text-right tabular-nums font-semibold ${changeClass}`}>
          {changePrefix}
          {formatCurrency(change)}
        </span>
        <span className="text-muted-foreground">Range</span>
        <span className="text-right tabular-nums">
          {formatCurrency(point.low)} - {formatCurrency(point.high)}
        </span>
      </div>
    </div>
  )
}

export function PnlCandlesPanel({ raceRanges }: PnlCandlesPanelProps) {
  const candle = buildCandleData(raceRanges)
  const chartHostRef = useRef<HTMLDivElement | null>(null)
  const [chartWidth, setChartWidth] = useState(0)

  useLayoutEffect(() => {
    const element = chartHostRef.current
    if (!element) {
      setChartWidth(0)
      return
    }

    const updateWidth = () => {
      setChartWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)))
    }

    updateWidth()

    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [candle.points.length])

  return (
    <div className="rounded-xl border border-border/50 bg-muted/10 p-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">P&L per Race</span>
        {candle.points.length > 0 ? (
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" />
              Win
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-destructive" />
              Loss
            </span>
          </div>
        ) : null}
      </div>

      <div className="h-64 min-w-0">
        {candle.points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Chart appears as races are settled.
          </div>
        ) : (
          <div ref={chartHostRef} className="relative h-full min-w-0">
            {chartWidth > 0 ? (
              <ComposedChart width={chartWidth} height={256} data={candle.points} margin={{ top: 12, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[candle.yDomainMin, candle.yDomainMax]}
                  allowDataOverflow
                  tickFormatter={(value) => formatCurrency(Number(value) - candle.shiftOffset)}
                />
                <Tooltip
                  cursor={{ stroke: "var(--primary)", strokeOpacity: 0.25, strokeWidth: 1 }}
                  content={<CandleTooltip />}
                />

                <Bar dataKey="bodyBase" stackId="body" fill="transparent" barSize={14} isAnimationActive={false} />
                <Bar dataKey="bodyRange" stackId="body" barSize={14} isAnimationActive={false} radius={[2, 2, 2, 2]}>
                  {candle.points.map((entry) => (
                    <Cell
                      key={`body-${entry.label}`}
                      fill={
                        entry.bodyTone === "up"
                          ? "var(--primary)"
                          : entry.bodyTone === "down"
                            ? "var(--destructive)"
                            : "var(--muted-foreground)"
                      }
                      opacity={entry.bodyTone === "flat" ? 0.5 : 0.85}
                    />
                  ))}
                </Bar>
              </ComposedChart>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
