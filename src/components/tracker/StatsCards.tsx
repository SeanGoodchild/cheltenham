import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatPercent } from "@/lib/format"
import type { GlobalStats, UserStats } from "@/lib/types"

type StatsCardsProps = {
  title: string
  stats: Pick<GlobalStats | UserStats, "totalStaked" | "totalReturns" | "roasPct" | "winPct" | "betsPlaced" | "averageStake"> & {
    profitLoss?: number
    biggestWin?: number
  }
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-subtle min-w-[160px]">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  )
}

export function StatsCards({ title, stats }: StatsCardsProps) {
  const meterTarget = Math.max(2500, Math.ceil(stats.totalStaked / 250) * 250)
  const meterPct = Math.min(100, (stats.totalStaked / meterTarget) * 100)

  return (
    <Card className="h-full shadow-xs">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="panel-subtle">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Cash-o-Meter</span>
            <span>{formatCurrency(stats.totalStaked)} / {formatCurrency(meterTarget)}</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${meterPct}%` }}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="grid auto-cols-fr grid-flow-col gap-2">
          <StatItem label="Total Staked" value={formatCurrency(stats.totalStaked)} />
          <StatItem label="Total Returns" value={formatCurrency(stats.totalReturns)} />
          <StatItem label="Bets Placed" value={String(stats.betsPlaced)} />
          <StatItem label="Average Stake" value={formatCurrency(stats.averageStake)} />
          <StatItem label="ROAS" value={formatPercent(stats.roasPct)} />
          <StatItem label="Win %" value={formatPercent(stats.winPct)} />
          {typeof stats.profitLoss === "number" ? (
            <StatItem label="Profit/Loss" value={formatCurrency(stats.profitLoss)} />
          ) : null}
          {typeof stats.biggestWin === "number" ? (
            <StatItem label="Biggest Win" value={formatCurrency(stats.biggestWin)} />
          ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
