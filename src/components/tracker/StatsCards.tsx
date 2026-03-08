import type { ReactNode } from "react"
import {
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
  title?: string
  headerRight?: ReactNode
  variant: "hero" | "other"
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

const HERO_STAT_CONFIG = [
  { key: "totalStaked", label: "Total Staked", mobileLabel: "Staked", icon: Banknote, format: "currency" },
  { key: "totalReturns", label: "Total Returns", mobileLabel: "Returns", icon: CircleDollarSign, format: "currency" },
  { key: "roasPct", label: "ROAS", mobileLabel: "ROAS", icon: Percent, format: "percent" },
] as const

const OTHER_STAT_CONFIG = [
  { key: "averageStake", label: "Avg Stake", icon: PiggyBank, format: "currency" },
  { key: "averageOdds", label: "Avg Odds", icon: Target, format: "odds" },
  { key: "winPct", label: "Win %", icon: Trophy, format: "percent" },
  { key: "betsPlaced", label: "Bets", icon: BarChart3, format: "number" },
  { key: "biggestLoss", label: "Worst Bet", icon: TrendingDown, format: "currency", negative: true },
  { key: "biggestWin", label: "Best Bet", icon: TrendingUp, format: "currency", positive: true },
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

export function StatsCards({ title, headerRight, variant, stats }: StatsCardsProps) {
  const statConfig = variant === "hero" ? HERO_STAT_CONFIG : OTHER_STAT_CONFIG

  return (
    <Card size="sm" className="h-full shadow-xs">
      {title ? (
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <CardTitle className="text-base font-bold">{title}</CardTitle>
            {headerRight}
          </div>
        </CardHeader>
      ) : null}
      <CardContent>
        {variant === "hero" ? (
          <div className="grid grid-cols-3 gap-2">
            {statConfig.map((config) => {
              const value = stats[config.key] as number
              const Icon = config.icon
              const mobileLabel = "mobileLabel" in config ? config.mobileLabel : config.label
              return (
                <div
                  key={config.key}
                  className="min-w-0 rounded-xl border border-border/50 bg-muted/20 px-2.5 py-2.5 md:p-3.5"
                >
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <Icon className="size-3 text-muted-foreground md:size-3.5" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground md:hidden">
                      {mobileLabel}
                    </span>
                    <span className="hidden text-[11px] uppercase tracking-wide text-muted-foreground md:inline">
                      {config.label}
                    </span>
                  </div>
                  <div className="mt-1.5 truncate text-sm font-bold leading-none tracking-tight tabular-nums min-[380px]:text-base md:mt-2.5 md:text-[1.65rem]">
                    {formatStatValue(value, config.format)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3">
            {statConfig.map((config) => {
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
        )}
      </CardContent>
    </Card>
  )
}
