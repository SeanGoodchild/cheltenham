import { useEffect, useMemo, useState } from "react"
import { BarChart3, ChevronDown, Menu, RefreshCw, Shield, UserRound, Wallet, X } from "lucide-react"

import { AdminPanel } from "@/components/tracker/AdminPanel"
import { BetPanel, type BetDraftForm } from "@/components/tracker/BetPanel"
import { MainBoard } from "@/components/tracker/MainBoard"
import { PersonalPanel } from "@/components/tracker/PersonalPanel"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { useTrackerData } from "@/hooks/useTrackerData"
import {
  createBet,
  generateRaceSimulation,
  getRaceSimulationInfo,
  getTrackerMode,
  getLastRaceImportRun,
  refreshRaceData,
  resolveOtherBetManually,
  removeBet,
  setTrackerMode,
  settleRace,
  type TrackerMode,
  updateBet,
  updateRaceResult,
} from "@/lib/firebase"
import { computeGlobalStats, computeUserStats } from "@/lib/settlement"
import { formatIso, nowIso } from "@/lib/time"
import type { Bet, GlobalStats, RaceImportRun } from "@/lib/types"
import { cn } from "@/lib/utils"

const USER_STORAGE_KEY = "cheltenham.selectedUser"
type AppTab = "new-bet" | "main-cashboard" | "user-summary"
type MainBoardUserView = { mode: "all" } | { mode: "custom"; userIds: string[] }

const TABS: Array<{ id: AppTab; label: string; shortLabel: string; icon: typeof Wallet }> = [
  { id: "new-bet", label: "New Bet", shortLabel: "Bet", icon: Wallet },
  { id: "main-cashboard", label: "Main Cashboard", shortLabel: "Main", icon: BarChart3 },
  { id: "user-summary", label: "My Summary", shortLabel: "Summary", icon: UserRound },
]

function toBetDraft(form: BetDraftForm) {
  return {
    userId: form.userId,
    betType: form.betType,
    betName: form.betName,
    stakeTotal: form.stakeTotal,
    oddsUsed: form.oddsUsed,
    ewTerms: form.ewTerms,
    legs: form.legs.map((leg) => ({
      ...leg,
      decimalOdds: leg.decimalOdds ?? null,
    })),
  }
}

function formatLastRefreshed(run: RaceImportRun | null): string {
  if (!run) {
    return "Never"
  }
  if (run.completedAt) {
    return `${formatIso(run.completedAt, "EEE d MMM HH:mm")} (${run.status})`
  }
  return `${formatIso(run.startedAt, "EEE d MMM HH:mm")} (${run.status})`
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

export function App() {
  const [trackerMode, setTrackerModeState] = useState<TrackerMode>(() => getTrackerMode())
  const { users, races, bets, userStats, globalStats, error, bootstrapping } = useTrackerData(trackerMode)
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
  const [adminOpen, setAdminOpen] = useState(false)
  const [identityDraftUserId, setIdentityDraftUserId] = useState("")
  const [mainBoardUserView, setMainBoardUserView] = useState<MainBoardUserView>({ mode: "all" })
  const [simulatingRaces, setSimulatingRaces] = useState(false)
  const [nowTickMs, setNowTickMs] = useState(() => Date.now())
  const [simulationInfo, setSimulationInfo] = useState<{
    generatedAt?: string
    runId?: string
    seed?: string
    racesSimulated: number
  } | null>(null)

  const derivedUserStats = useMemo(() => {
    if (userStats.length > 0) {
      return userStats
    }
    return users.map((user) => computeUserStats(user, bets))
  }, [bets, userStats, users])

  const derivedGlobalStats: GlobalStats = useMemo(() => {
    if (globalStats) {
      return globalStats
    }
    return computeGlobalStats(bets, users, nowIso())
  }, [bets, globalStats, users])

  const hasValidSelectedUser = users.some((user) => user.id === selectedUserId)
  const resolvedSelectedUserId = hasValidSelectedUser ? selectedUserId : ""
  const identityGateOpen = !bootstrapping && users.length > 0 && !hasValidSelectedUser
  const selectedSummaryUser = users.find((user) => user.id === resolvedSelectedUserId)
  const mainBoardUserOptions = useMemo(() => {
    const self = users.find((user) => user.id === resolvedSelectedUserId)
    if (!self) {
      return users
    }
    return [self, ...users.filter((user) => user.id !== self.id)]
  }, [resolvedSelectedUserId, users])
  const mainBoardSelectedUserIds = useMemo(() => {
    if (mainBoardUserView.mode === "all") {
      return mainBoardUserOptions.map((user) => user.id)
    }

    const valid = mainBoardUserView.userIds.filter((userId) =>
      mainBoardUserOptions.some((user) => user.id === userId),
    )
    if (!valid.length) {
      return mainBoardUserOptions.map((user) => user.id)
    }
    return valid
  }, [mainBoardUserOptions, mainBoardUserView])
  const mainBoardSelectedUserIdSet = useMemo(
    () => new Set(mainBoardSelectedUserIds),
    [mainBoardSelectedUserIds],
  )
  const isAllMainBoardUsersSelected =
    mainBoardUserView.mode === "all" || mainBoardSelectedUserIds.length === mainBoardUserOptions.length
  const mainBoardViewLabel = useMemo(() => {
    if (!mainBoardUserOptions.length || isAllMainBoardUsersSelected) {
      return "All The Lads"
    }
    if (mainBoardSelectedUserIds.length === 1) {
      return mainBoardUserOptions.find((user) => user.id === mainBoardSelectedUserIds[0])?.displayName ?? "1 lad"
    }
    return `${mainBoardSelectedUserIds.length} lads selected`
  }, [isAllMainBoardUsersSelected, mainBoardSelectedUserIds, mainBoardUserOptions])
  const mainBoardUsers =
    isAllMainBoardUsersSelected ? users : users.filter((user) => mainBoardSelectedUserIdSet.has(user.id))
  const mainBoardBets =
    isAllMainBoardUsersSelected ? bets : bets.filter((bet) => mainBoardSelectedUserIdSet.has(bet.userId))
  const mainBoardStats =
    isAllMainBoardUsersSelected
      ? derivedUserStats
      : derivedUserStats.filter((entry) => mainBoardSelectedUserIdSet.has(entry.userId))
  const mainBoardGlobalStats: GlobalStats =
    isAllMainBoardUsersSelected
      ? derivedGlobalStats
      : computeGlobalStats(mainBoardBets, mainBoardUsers, nowIso())
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]
  const lastRefreshedLabel = formatLastRefreshed(raceImportRun)
  const effectiveSelectedUserId = resolvedSelectedUserId || identityDraftUserId || users[0]?.id || ""
  const nextRaceCountdownLabel = useMemo(() => {
    const nextRace = races
      .filter((race) => new Date(race.offTime).getTime() > nowTickMs)
      .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())[0]

    if (!nextRace) {
      return "No upcoming race"
    }

    const msUntil = new Date(nextRace.offTime).getTime() - nowTickMs
    return `${formatIso(nextRace.offTime, "EEE HH:mm")} in ${formatCountdown(msUntil)}`
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

  const handleToggleMainBoardUser = (userId: string, checked: boolean | "indeterminate") => {
    if (!mainBoardUserOptions.length) {
      return
    }

    if (mainBoardUserView.mode === "all") {
      setMainBoardUserView({ mode: "custom", userIds: [userId] })
      return
    }

    const next = new Set(mainBoardUserView.userIds.filter((entry) => users.some((user) => user.id === entry)))
    if (checked === true) {
      next.add(userId)
    } else {
      if (next.size === 1 && next.has(userId)) {
        return
      }
      next.delete(userId)
    }

    const ordered = mainBoardUserOptions.map((user) => user.id).filter((id) => next.has(id))
    if (!ordered.length) {
      return
    }
    if (ordered.length === mainBoardUserOptions.length) {
      setMainBoardUserView({ mode: "all" })
      return
    }
    setMainBoardUserView({ mode: "custom", userIds: ordered })
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

  async function handleUpdateRaceResult(input: { raceId: string; winner?: string; placed: string[] }) {
    await updateRaceResult(input)
  }

  async function handleSettleRace(raceId: string) {
    await settleRace(raceId)
  }

  async function handleRefreshRaceData() {
    setActionError(null)
    setRefreshingRaceData(true)
    try {
      const payload = await refreshRaceData()
      setRaceImportRun(payload.run)
    } catch (refreshError) {
      setActionError(refreshError instanceof Error ? refreshError.message : "Failed to refresh race data")
    } finally {
      setRefreshingRaceData(false)
    }
  }

  async function handleGenerateSimulation() {
    setActionError(null)
    setSimulatingRaces(true)
    try {
      const result = await generateRaceSimulation()
      setSimulationInfo({
        generatedAt: result.generatedAt,
        runId: result.runId,
        seed: result.seed,
        racesSimulated: result.racesSimulated,
      })
      if (trackerMode !== "simulated") {
        setTrackerMode("simulated")
        setTrackerModeState("simulated")
      } else {
        setTrackerMode("simulated", { forceReconnect: true })
      }
    } catch (simulationError) {
      setActionError(simulationError instanceof Error ? simulationError.message : "Failed to simulate races")
    } finally {
      setSimulatingRaces(false)
    }
  }

  function handleToggleTrackerMode(nextMode: TrackerMode) {
    setActionError(null)
    setTrackerMode(nextMode)
    setTrackerModeState(nextMode)
  }

  function openAdminPanel() {
    setMobileMenuOpen(false)
    setAdminOpen(true)
  }

  useEffect(() => {
    if (bootstrapping) {
      return
    }
    void Promise.all([getLastRaceImportRun(), getRaceSimulationInfo()])
      .then(([run, info]) => {
        setRaceImportRun(run)
        setSimulationInfo(info)
      })
      .catch(() => {
        // non-fatal for initial render
      })
  }, [bootstrapping])

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
    if (users.length === 0) {
      return
    }
    if (mainBoardUserView.mode === "all") {
      return
    }
    const valid = mainBoardUserView.userIds.filter((userId) => users.some((user) => user.id === userId))
    if (!valid.length) {
      setMainBoardUserView({ mode: "all" })
      return
    }
    if (valid.length !== mainBoardUserView.userIds.length) {
      setMainBoardUserView({ mode: "custom", userIds: valid })
    }
  }, [mainBoardUserView, users])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTickMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  if (bootstrapping) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-4 md:p-6">
        <Card>
          <CardContent className="py-8 text-center">Compiling toots...</CardContent>
        </Card>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="md:grid md:min-h-screen md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden border-r border-border/80 bg-card/60 md:block">
          <div className="sticky top-0 flex h-screen flex-col gap-5 px-4 py-5">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cheltenham Festival 2026</div>
              <h1 className="text-2xl font-semibold">Ca$h Lad$ Tracker</h1>
            </div>

            <nav className="space-y-2">
              {TABS.map((tab) => (
                <Button
                  key={`desktop-tab-${tab.id}`}
                  type="button"
                  variant={activeTab === tab.id ? "default" : "ghost"}
                  className="w-full justify-start gap-2"
                  onClick={() => setActiveTab(tab.id)}
                >
                  <tab.icon className="size-4" />
                  {tab.label}
                </Button>
              ))}
            </nav>

            <div className="space-y-3 rounded-xl border border-border/70 bg-card px-3 py-3">
              <Button type="button" className="w-full justify-start gap-2" variant="outline" onClick={openAdminPanel}>
                <Shield className="size-4" />
                Admin actions
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 px-4 py-3 backdrop-blur md:hidden">
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Open menu"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="size-5" />
              </Button>
              <div className="min-w-0 text-center">
                <div className="truncate text-sm font-semibold">Cheltenham Bet Tracker</div>
                <div className="truncate text-xs text-muted-foreground">{activeTabMeta.label}</div>
              </div>
              <Badge variant="secondary" className="max-w-[170px] truncate text-[11px]">
                {nextRaceCountdownLabel}
              </Badge>
            </div>
            {trackerMode === "simulated" ? (
              <div className="mt-2 text-center">
                <Badge variant="outline">Simulated Results Mode</Badge>
              </div>
            ) : null}
          </header>

          <main className="flex-1 px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-6">
            <div className="mx-auto w-full max-w-6xl space-y-4">
              <div className="hidden items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-xs md:flex">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cheltenham Festival 2026</div>
                  <div className="text-lg font-semibold">{activeTabMeta.label}</div>
                </div>
                <Badge variant="secondary">{nextRaceCountdownLabel}</Badge>
              </div>
              {trackerMode === "simulated" ? (
                <div className="mt-2 flex justify-end">
                  <Badge variant="outline">Simulated Results Mode</Badge>
                </div>
              ) : null}

              {(error || actionError) && (
                <Card>
                  <CardContent className="py-4 text-sm text-destructive">{error ?? actionError}</CardContent>
                </Card>
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

              {activeTab === "main-cashboard" ? (
                <div className="space-y-4">
                  <StatsCards
                    title="Main Cashboard"
                    middleContent={<PnlCandlesPanel bets={mainBoardBets} races={races} />}
                    headerRight={
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="inline-flex h-9 min-w-[170px] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <span className="truncate">{mainBoardViewLabel}</span>
                          <ChevronDown className="size-4 text-muted-foreground" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuCheckboxItem
                            checked={isAllMainBoardUsersSelected}
                            onCheckedChange={(checked) => {
                              if (checked === true) {
                                setMainBoardUserView({ mode: "all" })
                              }
                            }}
                          >
                            All The Lads
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuSeparator />
                          {mainBoardUserOptions.map((user) => (
                            <DropdownMenuCheckboxItem
                              key={`main-view-user-${user.id}`}
                              checked={isAllMainBoardUsersSelected ? true : mainBoardSelectedUserIdSet.has(user.id)}
                              onCheckedChange={(checked) => handleToggleMainBoardUser(user.id, checked)}
                            >
                              {user.displayName}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                    stats={mainBoardGlobalStats}
                  />
                  <MainBoard
                    bets={mainBoardBets}
                    users={mainBoardUsers}
                    races={races}
                    stats={mainBoardStats}
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
            </div>
          </main>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-[86%] max-w-[320px] flex-col border-r border-border bg-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Menu</div>
                <div className="text-base font-semibold">Ca$h Lad$ Tracker</div>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}>
                <X className="size-5" />
              </Button>
            </div>

            <nav className="space-y-2">
              {TABS.map((tab) => (
                <Button
                  key={`mobile-tab-${tab.id}`}
                  type="button"
                  variant={activeTab === tab.id ? "default" : "ghost"}
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    setActiveTab(tab.id)
                    setMobileMenuOpen(false)
                  }}
                >
                  <tab.icon className="size-4" />
                  {tab.label}
                </Button>
              ))}
            </nav>

            <div className="mt-5 space-y-3 rounded-xl border border-border/70 bg-card px-3 py-3">
              <Button type="button" className="w-full justify-start gap-2" variant="outline" onClick={openAdminPanel}>
                <Shield className="size-4" />
                Admin actions
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] backdrop-blur md:hidden">
        <div className="grid grid-cols-3 gap-2">
          {TABS.map((tab) => (
            <Button
              key={`bottom-tab-${tab.id}`}
              type="button"
              size="sm"
              variant={activeTab === tab.id ? "default" : "ghost"}
              className="h-11 flex-col gap-1 text-[11px]"
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon className="size-4" />
              {tab.shortLabel}
            </Button>
          ))}
        </div>
      </nav>

      <AlertDialog open={identityGateOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Choose Your Lad</AlertDialogTitle>
            <AlertDialogDescription>
              Pick your identity to start. It is saved locally and can be changed later in Admin actions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="identity-gate-select">Lad</Label>
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
              disabled={!identityDraftUserId}
              onClick={() => {
                if (!identityDraftUserId) {
                  return
                }
                persistUserId(identityDraftUserId)
              }}
            >
              Continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={adminOpen} onOpenChange={setAdminOpen}>
        <AlertDialogContent className="!left-0 !top-auto !bottom-0 !h-[92vh] !w-full !max-w-none !translate-x-0 !translate-y-0 rounded-b-none rounded-t-2xl p-0 md:!left-1/2 md:!top-1/2 md:!bottom-auto md:!h-[86vh] md:!max-w-5xl md:!-translate-x-1/2 md:!-translate-y-1/2 md:rounded-2xl">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 md:px-6">
              <div className="space-y-0.5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Admin</div>
                <h2 className="text-base font-semibold">Race & settlement actions</h2>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setAdminOpen(false)}>
                Close
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <div className="mb-4 space-y-3 rounded-xl border border-border/70 bg-card p-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-1">
                    <Label htmlFor="admin-user-switch" className="text-xs uppercase tracking-wide text-muted-foreground">
                      Active Lad
                    </Label>
                    <select
                      id="admin-user-switch"
                      className="native-select"
                      value={effectiveSelectedUserId}
                      onChange={(event) => handleSwitchUser(event.target.value)}
                    >
                      {users.map((user) => (
                        <option key={`admin-user-${user.id}`} value={user.id}>
                          {user.displayName}
                        </option>
                      ))}
                    </select>
                    <div className="text-xs text-muted-foreground">Last refreshed: {lastRefreshedLabel}</div>
                  </div>
                  <Button
                    type="button"
                    className="justify-start gap-2"
                    variant="outline"
                    onClick={() => {
                      void handleRefreshRaceData()
                    }}
                    disabled={refreshingRaceData || trackerMode === "simulated"}
                  >
                    <RefreshCw className={cn("size-4", refreshingRaceData ? "animate-spin" : "")} />
                    {refreshingRaceData ? "Refreshing..." : "Refresh race data"}
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)] md:items-end">
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Data Mode</div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={trackerMode === "live" ? "default" : "outline"}
                        onClick={() => handleToggleTrackerMode("live")}
                      >
                        Live
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={trackerMode === "simulated" ? "default" : "outline"}
                        onClick={() => handleToggleTrackerMode("simulated")}
                      >
                        Simulated
                      </Button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void handleGenerateSimulation()
                    }}
                    disabled={simulatingRaces}
                  >
                    {simulatingRaces ? "Simulating..." : "Simulate all races"}
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    {simulationInfo?.generatedAt
                      ? `Simulation ready: ${formatIso(simulationInfo.generatedAt, "EEE d MMM HH:mm")} (${simulationInfo.racesSimulated} races)`
                      : "No simulation generated yet."}
                  </div>
                </div>
              </div>
              <AdminPanel
                races={races}
                onUpdateResult={handleUpdateRaceResult}
                onSettleRace={handleSettleRace}
              />
            </div>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default App
