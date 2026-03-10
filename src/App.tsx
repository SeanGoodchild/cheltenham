import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { Check, ChevronDown, Clock, Heart, Menu, Trophy, UserRound, Wallet, X } from "lucide-react"

import { BetPanel, type BetDraftForm } from "@/components/tracker/BetPanel"
import { MainBoard } from "@/components/tracker/MainBoard"
import { PersonalPanel } from "@/components/tracker/PersonalPanel"
import { WellbeingPanel } from "@/components/tracker/WellbeingPanel"
import { PnlCandlesPanel } from "@/components/tracker/PnlCandlesPanel"
import { StatsCards } from "@/components/tracker/StatsCards"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
// Card removed -- errors use inline div now
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { useTrackerData } from "@/hooks/useTrackerData"
import {
  createBet,
  getLastRaceImportRun,
  refreshRaceData,
  resolveOtherBetManually,
  removeBet,
  updateBet,
} from "@/lib/firebase"
import { getStoredOddsFormat, persistOddsFormat, type OddsFormat } from "@/lib/format"
import { buildRacePnlRanges, computeGlobalStats, computeUserStats } from "@/lib/settlement"
import { formatIso, nowIso } from "@/lib/time"
import type { Bet, GlobalStats, Race, RaceImportRun, UserProfile } from "@/lib/types"
import { cn } from "@/lib/utils"

const USER_STORAGE_KEY = "cheltenham.selectedUser"
type AppTab = "new-bet" | "main-cashboard" | "user-summary" | "wellbeing"
type MainBoardUserView = { mode: "all" | "me" }
const MINUTE_MS = 60_000
const AUTO_REFRESH_BUSY_BACKOFF_MS = MINUTE_MS
const AUTO_REFRESH_FAILED_BACKOFF_MS = 2 * MINUTE_MS
const OVERDUE_RACE_REFRESH_BACKOFF_MS = MINUTE_MS

type TabDef = { id: AppTab; label: string; shortLabel: string; icon: typeof Wallet }

/** Tabs shown in both sidebar and mobile footer */
const PRIMARY_TABS: TabDef[] = [
  { id: "new-bet", label: "Have a Toot", shortLabel: "Toot", icon: Wallet },
  { id: "main-cashboard", label: "Cashboard", shortLabel: "Board", icon: Trophy },
]

/** Tabs shown only in the sidebar / slide-out menu */
const SIDEBAR_TABS: TabDef[] = [
  { id: "user-summary", label: "My Toots", shortLabel: "My Toots", icon: UserRound },
  { id: "wellbeing", label: "Wellbeing", shortLabel: "Wellbeing", icon: Heart },
]

const ALL_TABS: TabDef[] = [...PRIMARY_TABS, ...SIDEBAR_TABS]

const USER_AVATAR_SRC_BY_ID: Record<string, string> = {
  fabs: "/avatars/Fabs.png",
  ru: "/avatars/Ru.png",
  shiblen: "/avatars/Shiblen.png",
  howes: "/avatars/Howes.png",
  steve: "/avatars/Steve.png",
  sean: "/avatars/Sean.png",
  gordo: "/avatars/Gordo.png",
  tim: "/avatars/Tim.png",
  wilks: "/avatars/Wilkes.png",
  grandad_packet: "/avatars/Grandad Packet.png",
}

function toBetDraft(form: BetDraftForm) {
  return {
    userId: form.userId,
    betType: form.betType,
    betName: form.betName,
    stakeTotal: form.stakeTotal,
    isFreeBet: form.isFreeBet,
    oddsUsed: form.oddsUsed,
    ewTerms: form.ewTerms,
    legs: form.legs.map((leg) => ({
      ...leg,
      decimalOdds: leg.decimalOdds ?? null,
    })),
  }
}

function formatCountdown(msUntil: number): string {
  const totalSeconds = Math.max(0, Math.floor(msUntil / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function resolveAutoRefreshRace(races: Race[]): Race | null {
  return [...races]
    .filter((race) => race.status !== "settled" && race.status !== "result_pending")
    .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())[0] ?? null
}

function resolveAutoRefreshInterval(offTimeIso: string, nowMs: number): { intervalMs: number; nextBoundaryAtMs?: number } {
  const offTimeMs = new Date(offTimeIso).getTime()
  const msUntilOff = offTimeMs - nowMs

  if (msUntilOff > 90 * MINUTE_MS) {
    return { intervalMs: 15 * MINUTE_MS, nextBoundaryAtMs: offTimeMs - 90 * MINUTE_MS }
  }
  if (msUntilOff > 30 * MINUTE_MS) {
    return { intervalMs: 10 * MINUTE_MS, nextBoundaryAtMs: offTimeMs - 30 * MINUTE_MS }
  }
  if (msUntilOff > 10 * MINUTE_MS) {
    return { intervalMs: 5 * MINUTE_MS, nextBoundaryAtMs: offTimeMs - 10 * MINUTE_MS }
  }
  if (msUntilOff > -15 * MINUTE_MS) {
    return { intervalMs: 90_000, nextBoundaryAtMs: offTimeMs + 15 * MINUTE_MS }
  }
  if (msUntilOff > -30 * MINUTE_MS) {
    return { intervalMs: 3 * MINUTE_MS, nextBoundaryAtMs: offTimeMs + 30 * MINUTE_MS }
  }
  return { intervalMs: 5 * MINUTE_MS }
}

function resolveNextEligibleRefreshAt(run: RaceImportRun | null, intervalMs: number, nowMs: number): number {
  if (!run) {
    return nowMs
  }

  if (run.status === "busy" || run.status === "running") {
    return nowMs + AUTO_REFRESH_BUSY_BACKOFF_MS
  }

  const completedAtMs = run.completedAt ? new Date(run.completedAt).getTime() : NaN
  if (!Number.isFinite(completedAtMs)) {
    return nowMs
  }

  if (run.status === "failed") {
    return completedAtMs + AUTO_REFRESH_FAILED_BACKOFF_MS
  }

  return completedAtMs + intervalMs
}

function resolveNextAutoRefreshDelay(input: {
  nowMs: number
  intervalMs: number
  nextEligibleAtMs: number
  nextBoundaryAtMs?: number
}): number {
  const candidates = [
    Math.max(1_000, input.nextEligibleAtMs - input.nowMs),
    input.intervalMs,
  ]

  if (typeof input.nextBoundaryAtMs === "number" && Number.isFinite(input.nextBoundaryAtMs)) {
    candidates.push(Math.max(1_000, input.nextBoundaryAtMs - input.nowMs))
  }

  return Math.max(1_000, Math.min(...candidates))
}

function getUserAvatarSrc(user: Pick<UserProfile, "id"> | null | undefined) {
  if (!user) {
    return null
  }
  return USER_AVATAR_SRC_BY_ID[user.id] ?? null
}

function UserAvatar({
  name,
  src,
  size = "md",
}: {
  name: string
  src?: string | null
  size?: "sm" | "md" | "lg"
}) {
  const initials = name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const sizeClass = size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs"

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl font-semibold text-primary",
        !src && "bg-primary/15",
        sizeClass,
      )}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </div>
  )
}

function UserSwitcher({
  users,
  selectedUserId,
  onSwitchUser,
  betCount,
}: {
  users: UserProfile[]
  selectedUserId: string
  onSwitchUser: (value: string) => void
  betCount: number
}) {
  const selectedUser = users.find((user) => user.id === selectedUserId)
  if (!selectedUser) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-3 py-2 text-left shadow-sm transition-colors hover:bg-muted/40",
        )}
      >
        <UserAvatar
          name={selectedUser.displayName}
          src={getUserAvatarSrc(selectedUser)}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{selectedUser.displayName}</div>
          <div className="text-[11px] text-muted-foreground">{betCount} bets placed</div>
        </div>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Swap lad</div>
        <DropdownMenuSeparator />
        {users.map((user) => {
          const isSelected = user.id === selectedUserId
          return (
            <DropdownMenuItem
              key={`user-switch-${user.id}`}
              className="gap-3 py-2"
              onClick={() => onSwitchUser(user.id)}
            >
              <UserAvatar name={user.displayName} src={getUserAvatarSrc(user)} size="sm" />
              <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
              {isSelected ? <Check className="size-4 text-primary" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function App() {
  const { users, races, bets, userStats, globalStats, error, bootstrapping } = useTrackerData()
  const [selectedUserId, setSelectedUserId] = useState<string>(() => {
    if (typeof window === "undefined") {
      return ""
    }
    return window.localStorage.getItem(USER_STORAGE_KEY) ?? ""
  })
  const [actionError, setActionError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AppTab>("new-bet")
  const [raceImportRun, setRaceImportRun] = useState<RaceImportRun | null>(null)
  const [refreshingRaceData, setRefreshingRaceData] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [identityDraftUserId, setIdentityDraftUserId] = useState("")
  const [mainBoardUserView, setMainBoardUserView] = useState<MainBoardUserView>({ mode: "all" })
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>(() => getStoredOddsFormat())
  const [nowTickMs, setNowTickMs] = useState(() => Date.now())
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  )
  const raceImportRunRef = useRef<RaceImportRun | null>(null)
  const overdueRefreshAttemptRef = useRef<{ raceId: string; attemptedAtMs: number } | null>(null)
  const isMainBoardActive = activeTab === "main-cashboard"

  const hasValidSelectedUser = users.some((user) => user.id === selectedUserId)
  const resolvedSelectedUserId = hasValidSelectedUser ? selectedUserId : ""
  const identityGateOpen = !bootstrapping && users.length > 0 && !hasValidSelectedUser
  const selectedSummaryUser = users.find((user) => user.id === resolvedSelectedUserId)
  const isGordoUltraDark = resolvedSelectedUserId === "gordo"
  const selectedUserBetCount = useMemo(
    () => bets.filter((bet) => bet.userId === resolvedSelectedUserId).length,
    [bets, resolvedSelectedUserId],
  )
  const appThemeStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isGordoUltraDark) {
      return undefined
    }

    return {
      "--background": "#000000",
      "--card": "#000000",
      "--popover": "#000000",
      "--sidebar": "#000000",
    } as CSSProperties
  }, [isGordoUltraDark])
  const isMainBoardMeView = mainBoardUserView.mode === "me" && Boolean(resolvedSelectedUserId)
  const mainBoardData = useMemo(() => {
    if (!isMainBoardActive) {
      return null
    }

    const scopedUsers =
      isMainBoardMeView ? users.filter((user) => user.id === resolvedSelectedUserId) : users
    const scopedBets =
      isMainBoardMeView ? bets.filter((bet) => bet.userId === resolvedSelectedUserId) : bets
    const allUserStats = userStats.length > 0 ? userStats : users.map((user) => computeUserStats(user, bets))
    const scopedStats =
      isMainBoardMeView
        ? allUserStats.filter((entry) => entry.userId === resolvedSelectedUserId)
        : allUserStats
    const scopedGlobalStats: GlobalStats =
      !isMainBoardMeView
        ? globalStats ?? computeGlobalStats(bets, users, nowIso())
        : computeGlobalStats(scopedBets, scopedUsers, nowIso())

    return {
      users: scopedUsers,
      bets: scopedBets,
      stats: scopedStats,
      globalStats: scopedGlobalStats,
      raceRanges: buildRacePnlRanges(races, scopedBets),
    }
  }, [
    bets,
    globalStats,
    isMainBoardActive,
    isMainBoardMeView,
    races,
    resolvedSelectedUserId,
    userStats,
    users,
  ])
  const nextRaceInfo = useMemo(() => {
    const nextRace = races
      .filter((race) => new Date(race.offTime).getTime() > nowTickMs)
      .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())[0]

    if (!nextRace) {
      return { label: "No upcoming race", countdown: "" }
    }

    const msUntil = new Date(nextRace.offTime).getTime() - nowTickMs
    return {
      label: formatIso(nextRace.offTime, "EEE HH:mm"),
      countdown: formatCountdown(msUntil),
    }
  }, [nowTickMs, races])

  const persistUserId = (value: string) => {
    setSelectedUserId(value)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(USER_STORAGE_KEY, value)
    }
  }

  const handleSwitchUser = (value: string) => {
    persistUserId(value)
    setIdentityDraftUserId(value)
    setMobileMenuOpen(false)
  }

  async function handleCreateBet(form: BetDraftForm) {
    setActionError(null)
    await createBet(toBetDraft(form), races)
  }

  async function handleUpdateBet(betId: string, form: BetDraftForm, currentBet: Bet) {
    setActionError(null)
    await updateBet(betId, toBetDraft(form), races, currentBet)
  }

  async function handleDeleteBet(bet: Bet) {
    setActionError(null)
    await removeBet(bet)
  }

  async function handleResolveOtherBet(input: { betId: string; totalReturn: number }) {
    setActionError(null)
    await resolveOtherBetManually(input)
  }

  async function runRaceRefresh() {
    setRefreshingRaceData(true)
    try {
      const payload = await refreshRaceData()
      setRaceImportRun(payload.run)
      return payload.run
    } catch (refreshError) {
      setActionError(refreshError instanceof Error ? refreshError.message : "Failed to refresh race data")
      return null
    } finally {
      setRefreshingRaceData(false)
    }
  }

  function handleOddsFormatChange(nextFormat: OddsFormat) {
    setOddsFormat(nextFormat)
    persistOddsFormat(nextFormat)
  }

  useEffect(() => {
    if (users.length === 0) {
      return
    }
    if (hasValidSelectedUser) {
      setIdentityDraftUserId(selectedUserId)
      return
    }
    if (!users.some((user) => user.id === identityDraftUserId)) {
      setIdentityDraftUserId(users[0].id)
    }
  }, [hasValidSelectedUser, identityDraftUserId, selectedUserId, users])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    raceImportRunRef.current = raceImportRun
  }, [raceImportRun])

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === "visible")
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (bootstrapping || !isPageVisible || refreshingRaceData) {
      return
    }

    let cancelled = false
    let timeoutId: number | null = null

    const scheduleNextCheck = (delayMs: number) => {
      if (cancelled) {
        return
      }
      timeoutId = window.setTimeout(() => {
        void evaluateAutoRefresh()
      }, delayMs)
    }

    const evaluateAutoRefresh = async () => {
      if (cancelled || typeof document !== "undefined" && document.visibilityState !== "visible") {
        return
      }

      const targetRace = resolveAutoRefreshRace(races)
      if (!targetRace) {
        return
      }

      const nowMs = Date.now()
      const targetRaceOffMs = new Date(targetRace.offTime).getTime()
      const overdueAttempt = overdueRefreshAttemptRef.current
      const overdueAttemptIsFresh =
        overdueAttempt?.raceId === targetRace.id &&
        nowMs - overdueAttempt.attemptedAtMs < OVERDUE_RACE_REFRESH_BACKOFF_MS

      if (targetRaceOffMs <= nowMs && !overdueAttemptIsFresh) {
        overdueRefreshAttemptRef.current = { raceId: targetRace.id, attemptedAtMs: nowMs }
        await runRaceRefresh()
        return
      }

      const { intervalMs, nextBoundaryAtMs } = resolveAutoRefreshInterval(targetRace.offTime, nowMs)

      let latestRun = raceImportRunRef.current
      try {
        latestRun = await getLastRaceImportRun()
        if (!cancelled) {
          setRaceImportRun(latestRun)
        }
      } catch {
        // keep the local run snapshot if the status check fails
      }

      const nextEligibleAtMs = resolveNextEligibleRefreshAt(latestRun, intervalMs, nowMs)
      if (nextEligibleAtMs <= nowMs) {
        const run = await runRaceRefresh()
        if (cancelled) {
          return
        }

        const completedAtMs = run?.completedAt ? new Date(run.completedAt).getTime() : Date.now()
        scheduleNextCheck(
          resolveNextAutoRefreshDelay({
            nowMs: completedAtMs,
            intervalMs,
            nextEligibleAtMs: completedAtMs + intervalMs,
            nextBoundaryAtMs,
          }),
        )
        return
      }

      scheduleNextCheck(
        resolveNextAutoRefreshDelay({
          nowMs,
          intervalMs,
          nextEligibleAtMs,
          nextBoundaryAtMs,
        }),
      )
    }

    void evaluateAutoRefresh()

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [
    bootstrapping,
    isPageVisible,
    races,
    refreshingRaceData,
  ])

  // --- Loading state ---
  if (bootstrapping) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <div className="text-sm font-medium text-muted-foreground">Compiling Toots...</div>
        </div>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-background" style={appThemeStyle}>
      <div className="md:grid md:min-h-screen md:grid-cols-[260px_minmax(0,1fr)]">
        {/* ─── Desktop Sidebar ─── */}
        <aside className="hidden border-r border-border/60 bg-card/40 md:block">
          <div className="sticky top-0 flex h-screen flex-col px-4 py-5">
            {/* Brand */}
            <div className="mb-4 space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                Ca$h Lad$
              </div>
              <h1 className="text-xl font-bold tracking-tight">Cheltenham 2026</h1>
            </div>

            {/* User identity */}
            <div className="mb-4">
              <UserSwitcher
                users={users}
                selectedUserId={resolvedSelectedUserId}
                onSwitchUser={handleSwitchUser}
                betCount={selectedUserBetCount}
              />
            </div>

            {/* Nav tabs */}
            <nav className="space-y-1">
              {ALL_TABS.map((tab) => (
                <button
                  key={`desktop-tab-${tab.id}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    activeTab === tab.id
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                  )}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <tab.icon className="size-4" />
                  {tab.label}
                </button>
              ))}

              {nextRaceInfo.countdown ? (
                <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <Clock className="size-3" />
                    Next race
                  </div>
                  <div className="mt-1 text-sm font-semibold">{nextRaceInfo.label}</div>
                  <div className="text-xs text-muted-foreground">in {nextRaceInfo.countdown}</div>
                </div>
              ) : null}
            </nav>

            {/* Spacer */}
            <div className="flex-1" />

            <div className="space-y-2">
              <div className="rounded-xl border border-border/50 bg-muted/10 p-2">
                <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Odds Display
                </div>
                <div className="inline-flex w-full items-center rounded-lg border border-input bg-muted/20 p-1">
                  <button
                    type="button"
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                      oddsFormat === "fractional"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => handleOddsFormatChange("fractional")}
                  >
                    Fractional
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                      oddsFormat === "decimal"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => handleOddsFormatChange("decimal")}
                  >
                    Decimal
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ─── Main Content ─── */}
        <div className="flex min-h-screen flex-col">
          {/* Mobile header */}
          <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 px-4 py-2.5 backdrop-blur-xl md:hidden">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                aria-label="Open menu"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="size-5" />
              </button>
              <div className="min-w-0 text-center">
                <div className="text-sm font-bold tracking-tight">Ca$h Lad$</div>
              </div>
              <div className="w-9" />
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 px-4 pt-2.5 pb-20 md:px-6 md:py-5 md:pb-6">
            <div className="mx-auto w-full max-w-6xl space-y-3 md:space-y-4">
              {(error || actionError) && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error ?? actionError}
                </div>
              )}

              {activeTab === "new-bet" ? (
                <BetPanel
                  races={races}
                  bets={bets}
                  selectedUserId={resolvedSelectedUserId}
                  onCreateBet={handleCreateBet}
                  onUpdateBet={handleUpdateBet}
                  onDeleteBet={handleDeleteBet}
                />
              ) : null}

              {activeTab === "main-cashboard" && mainBoardData ? (
                <div className="space-y-3 md:space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold">Cashboard</h2>
                    <div className="inline-flex h-8 items-center rounded-lg border border-input bg-muted/20 p-1">
                      <button
                        type="button"
                        className={cn(
                          "rounded-md px-3 py-0.5 text-sm transition-colors",
                          mainBoardUserView.mode === "all"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setMainBoardUserView({ mode: "all" })}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-md px-3 py-0.5 text-sm transition-colors",
                          mainBoardUserView.mode === "me"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setMainBoardUserView({ mode: "me" })}
                      >
                        Me
                      </button>
                    </div>
                  </div>
                  <StatsCards
                    variant="hero"
                    stats={mainBoardData.globalStats}
                  />
                  <PnlCandlesPanel raceRanges={mainBoardData.raceRanges} />
                  <MainBoard
                    bets={mainBoardData.bets}
                    allBets={bets}
                    users={mainBoardData.users}
                    allUsers={users}
                    races={races}
                    stats={mainBoardData.stats}
                  />
                  <StatsCards
                    title="Other Stats"
                    variant="other"
                    stats={mainBoardData.globalStats}
                  />
                </div>
              ) : null}

              {activeTab === "user-summary" ? (
                <PersonalPanel
                  user={selectedSummaryUser}
                  bets={bets}
                  races={races}
                  onResolveOtherBet={handleResolveOtherBet}
                />
              ) : null}

              {activeTab === "wellbeing" ? <WellbeingPanel /> : null}
            </div>
          </main>
        </div>
      </div>

      {/* ─── Mobile Slide-out Menu ─── */}
      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-[82%] max-w-[300px] flex-col border-r border-border/60 bg-card p-4">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                  Ca$h Lad$
                </div>
                <div className="text-base font-bold tracking-tight">Cheltenham 2026</div>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/30"
                aria-label="Close menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mb-4">
              <UserSwitcher
                users={users}
                selectedUserId={resolvedSelectedUserId}
                onSwitchUser={handleSwitchUser}
                betCount={selectedUserBetCount}
              />
            </div>

            <nav className="space-y-1">
              {ALL_TABS.map((tab) => (
                <button
                  key={`mobile-tab-${tab.id}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    activeTab === tab.id
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                  )}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setMobileMenuOpen(false)
                  }}
                >
                  <tab.icon className="size-4" />
                  {tab.label}
                </button>
              ))}

              {nextRaceInfo.countdown ? (
                <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <Clock className="size-3" />
                    Next race
                  </div>
                  <div className="mt-1 text-sm font-semibold">{nextRaceInfo.label}</div>
                  <div className="text-xs text-muted-foreground">in {nextRaceInfo.countdown}</div>
                </div>
              ) : null}
            </nav>

            <div className="flex-1" />

            <div className="space-y-2">
              <div className="rounded-xl border border-border/50 bg-muted/10 p-2">
                <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Odds Display
                </div>
                <div className="inline-flex w-full items-center rounded-lg border border-input bg-muted/20 p-1">
                  <button
                    type="button"
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                      oddsFormat === "fractional"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => handleOddsFormatChange("fractional")}
                  >
                    Fractional
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                      oddsFormat === "decimal"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => handleOddsFormatChange("decimal")}
                  >
                    Decimal
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {/* ─── Mobile Bottom Nav ─── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 px-3 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] backdrop-blur-xl md:hidden">
        <div className="flex justify-around">
          {PRIMARY_TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={`bottom-tab-${tab.id}`}
                type="button"
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg px-4 py-1.5 text-[11px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                  isActive ? "bg-primary/15" : "",
                )}>
                  <tab.icon className="size-4" />
                </div>
                {tab.shortLabel}
              </button>
            )
          })}
        </div>
      </nav>

      {/* ─── Identity Gate ─── */}
      <AlertDialog open={identityGateOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-xl">Welcome, lad</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Pick your name to get started. You can change this any time from the avatar switcher.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="identity-gate-select" className="text-xs uppercase tracking-wide text-muted-foreground">
              Who are you?
            </Label>
            <select
              id="identity-gate-select"
              className="native-select"
              value={identityDraftUserId}
              onChange={(event) => setIdentityDraftUserId(event.target.value)}
            >
              {users.map((user) => (
                <option key={`identity-user-${user.id}`} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </div>
          <AlertDialogFooter>
            <Button
              type="button"
              className="w-full"
              disabled={!identityDraftUserId}
              onClick={() => {
                if (!identityDraftUserId) {
                  return
                }
                persistUserId(identityDraftUserId)
              }}
            >
              Let's go
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}

export default App
