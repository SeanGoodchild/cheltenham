import type { ReactNode } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  CircleDollarSign,
  Percent,
  PiggyBank,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatOdds, formatPercent } from "@/lib/format"
import type { GlobalStats, UserStats } from "@/lib/types"
import { cn } from "@/lib/utils"

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

const STAT_CONFIG = [
  { key: "totalStaked", label: "Total Staked", icon: Banknote, format: "currency" },
  { key: "totalReturns", label: "Returns", icon: CircleDollarSign, format: "currency" },
  { key: "roasPct", label: "ROAS", icon: Percent, format: "percent" },
  { key: "averageStake", label: "Avg Stake", icon: PiggyBank, format: "currency" },
  { key: "averageOdds", label: "Avg Odds", icon: Target, format: "odds" },
  { key: "winPct", label: "Win %", icon: Trophy, format: "percent" },
  { key: "betsPlaced", label: "Bets", icon: BarChart3, format: "number" },
  { key: "biggestLoss", label: "Worst Bet", icon: TrendingDown, format: "currency", negative: true },
  { key: "biggestWin", label: "Best Win", icon: TrendingUp, format: "currency", positive: true },
] as const

function formatStatValue(value: number, format: string): string {
  switch (format) {
    case "currency":
      return formatCurrency(value)
    case "percent":
      return formatPercent(value)
    case "odds":
      return value > 0 ? formatOdds(value) : "-"
    case "number":
      return String(value)
    default:
      return String(value)
  }
}

export function StatsCards({ title, middleContent, headerRight, stats }: StatsCardsProps) {
  const meterTarget = Math.max(2500, Math.ceil(stats.totalStaked / 250) * 250)
  const meterPct = Math.min(100, (stats.totalStaked / meterTarget) * 100)
  const pnl = stats.totalReturns - stats.totalStaked
  const isProfitable = pnl >= 0

  return (
    <Card className="h-full shadow-xs">
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardTitle className="text-base font-bold">{title}</CardTitle>
          {headerRight}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cash-o-Meter */}
        <div className="rounded-xl border border-border/50 bg-muted/15 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Cash-o-Meter</span>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatCurrency(stats.totalStaked)} / {formatCurrency(meterTarget)}
            </span>
          </div>
          <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-muted/50">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-700 ease-out"
              style={{ width: `${meterPct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{meterPct.toFixed(0)}% of target</span>
            <span className={cn(
              "flex items-center gap-1 font-semibold",
              isProfitable ? "text-primary" : "text-destructive",
            )}>
              {isProfitable ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {formatCurrency(pnl)} P&L
            </span>
          </div>
        </div>

        {middleContent}

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2">
          {STAT_CONFIG.map((config) => {
            const value = stats[config.key] as number
            const Icon = config.icon
            return (
              <div key={config.key} className="stat-card">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-3 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{config.label}</span>
                </div>
                <div className={cn(
                  "mt-1.5 truncate text-sm font-bold tabular-nums",
                  "negative" in config && config.negative && value < 0 ? "text-destructive" : "",
                  "positive" in config && config.positive && value > 0 ? "text-primary" : "",
                )}>
                  {formatStatValue(value, config.format)}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
