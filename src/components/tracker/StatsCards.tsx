import type { ReactNode } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatOdds, formatPercent } from "@/lib/format"
import type { GlobalStats, UserStats } from "@/lib/types"

type StatsCardsProps = {
  title: string
  middleContent?: ReactNode
  headerRight?: ReactNode
  stats: Pick<
    GlobalStats | UserStats,
    | "totalStaked"
    | "totalReturns"
    | "roasPct"
    | "averageStake"
    | "averageOdds"
    | "winPct"
    | "betsPlaced"
    | "biggestLoss"
    | "biggestWin"
  >
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-subtle min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-base font-semibold">{value}</div>
    </div>
  )
}

export function StatsCards({ title, middleContent, headerRight, stats }: StatsCardsProps) {
  const meterTarget = Math.max(2500, Math.ceil(stats.totalStaked / 250) * 250)
  const meterPct = Math.min(100, (stats.totalStaked / meterTarget) * 100)

  return (
    <Card className="h-full shadow-xs">
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          {headerRight}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="panel-subtle">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Cash-o-Meter</span>
            <span>
              {formatCurrency(stats.totalStaked)} / {formatCurrency(meterTarget)}
            </span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${meterPct}%` }}
            />
          </div>
        </div>

        {middleContent}

        <div className="grid grid-cols-3 gap-2">
          <StatItem label="Total Staked" value={formatCurrency(stats.totalStaked)} />
          <StatItem label="Total Returns" value={formatCurrency(stats.totalReturns)} />
          <StatItem label="ROAS" value={formatPercent(stats.roasPct)} />
          <StatItem label="Avg Stake" value={formatCurrency(stats.averageStake)} />
          <StatItem label="Avg Odds" value={stats.averageOdds > 0 ? formatOdds(stats.averageOdds) : "-"} />
          <StatItem label="Win %" value={formatPercent(stats.winPct)} />
          <StatItem label="Bets Placed" value={String(stats.betsPlaced)} />
          <StatItem label="Biggest Loss" value={formatCurrency(stats.biggestLoss)} />
          <StatItem label="Biggest Win" value={formatCurrency(stats.biggestWin)} />
        </div>
      </CardContent>
    </Card>
  )
}
