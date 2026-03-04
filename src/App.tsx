import { useEffect, useMemo, useState } from "react"
import { BarChart3, Menu, RefreshCw, Shield, UserRound, Wallet, X } from "lucide-react"

import { AdminPanel } from "@/components/tracker/AdminPanel"
import { BetPanel, type BetDraftForm } from "@/components/tracker/BetPanel"
import { MainBoard } from "@/components/tracker/MainBoard"
import { PersonalPanel } from "@/components/tracker/PersonalPanel"
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
import { Label } from "@/components/ui/label"
import { useTrackerData } from "@/hooks/useTrackerData"
import {
  createBet,
  createRace,
  getLastRaceImportRun,
  publishDailySummary,
  recomputeAndPersistStats,
  refreshRaceData,
  removeBet,
  setRaceImportLock,
  settleRace,
  updateBet,
  updateRaceResult,
} from "@/lib/firebase"
import { computeGlobalStats, computeUserStats } from "@/lib/settlement"
import { formatIso, nowIso } from "@/lib/time"
import type { Bet, GlobalStats, RaceImportRun } from "@/lib/types"
import { cn } from "@/lib/utils"

const USER_STORAGE_KEY = "cheltenham.selectedUser"
type AppTab = "new-bet" | "main-cashboard" | "user-summary"

const TABS: Array<{ id: AppTab; label: string; shortLabel: string; icon: typeof Wallet }> = [
  { id: "new-bet", label: "New Bet", shortLabel: "Bet", icon: Wallet },
  { id: "main-cashboard", label: "Main Cashboard", shortLabel: "Main", icon: BarChart3 },
  { id: "user-summary", label: "My Summary", shortLabel: "Summary", icon: UserRound },
]

function toBetDraft(form: BetDraftForm) {
  return {
    userId: form.userId,
    betType: form.betType,
    stakeTotal: form.stakeTotal,
    ewTerms: form.ewTerms,
    legs: form.legs.map((leg) => ({
      ...leg,
      decimalOdds: Number(leg.decimalOdds ?? 0),
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
  const [adminOpen, setAdminOpen] = useState(false)
  const [identityDraftUserId, setIdentityDraftUserId] = useState("")

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
  const selectedUser = users.find((user) => user.id === resolvedSelectedUserId)
  const selectedUserStats = derivedUserStats.find((entry) => entry.userId === resolvedSelectedUserId)
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) ?? TABS[0]
  const lastRefreshedLabel = formatLastRefreshed(raceImportRun)
  const effectiveSelectedUserId = resolvedSelectedUserId || identityDraftUserId || users[0]?.id || ""

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

  async function handleCreateRace(input: {
    day: "Tuesday" | "Wednesday" | "Thursday" | "Friday"
    offTime: string
    name: string
    runners: string[]
  }) {
    await createRace(input)
    await recomputeAndPersistStats()
  }

  async function handleUpdateRaceResult(input: { raceId: string; winner?: string; placed: string[] }) {
    await updateRaceResult(input)
  }

  async function handleSettleRace(raceId: string) {
    await settleRace(raceId)
  }

  async function handleQueueDailySummary(stats: GlobalStats) {
    await publishDailySummary(stats)
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

  function openAdminPanel() {
    setMobileMenuOpen(false)
    setAdminOpen(true)
  }

  async function handleSetRaceImportLock(input: { raceId: string; locked: boolean; reason?: string }) {
    await setRaceImportLock(input)
  }

  useEffect(() => {
    if (bootstrapping) {
      return
    }
    void getLastRaceImportRun()
      .then((run) => setRaceImportRun(run))
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

  if (bootstrapping) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl p-4 md:p-6">
        <Card>
          <CardContent className="py-8 text-center">Bootstrapping Firestore season data...</CardContent>
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
              <h1 className="text-2xl font-semibold">Cash Lads Tracker</h1>
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
              <div className="space-y-1">
                <Label htmlFor="desktop-user-switch" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Current Lad
                </Label>
                <select
                  id="desktop-user-switch"
                  className="native-select"
                  value={effectiveSelectedUserId}
                  onChange={(event) => handleSwitchUser(event.target.value)}
                >
                  {users.map((user) => (
                    <option key={`desktop-user-${user.id}`} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                type="button"
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={handleRefreshRaceData}
                disabled={refreshingRaceData}
              >
                <RefreshCw className={cn("size-4", refreshingRaceData ? "animate-spin" : "")} />
                {refreshingRaceData ? "Refreshing..." : "Refresh race data"}
              </Button>

              <div className="rounded-md border border-border/70 bg-muted/25 px-2 py-1.5 text-xs text-muted-foreground">
                Last refreshed: {lastRefreshedLabel}
              </div>

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
              <Badge variant="secondary" className="max-w-[130px] truncate">
                {selectedUser?.displayName ?? "No lad"}
              </Badge>
            </div>
          </header>

          <main className="flex-1 px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-6">
            <div className="mx-auto w-full max-w-6xl space-y-4">
              <div className="hidden items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-xs md:flex">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cheltenham Festival 2026</div>
                  <div className="text-lg font-semibold">{activeTabMeta.label}</div>
                </div>
                <Badge variant="secondary">{selectedUser?.displayName ?? "Pick your lad"}</Badge>
              </div>

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
                  <StatsCards title="Main Cashboard" stats={derivedGlobalStats} />
                  <MainBoard bets={bets} users={users} races={races} stats={derivedUserStats} />
                </div>
              ) : null}

              {activeTab === "user-summary" ? (
                <PersonalPanel user={selectedUser} userStats={selectedUserStats} bets={bets} races={races} />
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
                <div className="text-base font-semibold">Cash Lads Tracker</div>
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
              <div className="space-y-1">
                <Label htmlFor="mobile-user-switch" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Current Lad
                </Label>
                <select
                  id="mobile-user-switch"
                  className="native-select"
                  value={effectiveSelectedUserId}
                  onChange={(event) => handleSwitchUser(event.target.value)}
                >
                  {users.map((user) => (
                    <option key={`mobile-user-${user.id}`} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                type="button"
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={() => {
                  setMobileMenuOpen(false)
                  void handleRefreshRaceData()
                }}
                disabled={refreshingRaceData}
              >
                <RefreshCw className={cn("size-4", refreshingRaceData ? "animate-spin" : "")} />
                {refreshingRaceData ? "Refreshing..." : "Refresh race data"}
              </Button>

              <div className="rounded-md border border-border/70 bg-muted/25 px-2 py-1.5 text-xs text-muted-foreground">
                Last refreshed: {lastRefreshedLabel}
              </div>

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
              Pick your identity once. This is saved locally and used across New Bet, Main, and My Summary.
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
              <AdminPanel
                races={races}
                globalStats={derivedGlobalStats}
                onCreateRace={handleCreateRace}
                onUpdateResult={handleUpdateRaceResult}
                onSettleRace={handleSettleRace}
                onQueueDailySummary={handleQueueDailySummary}
                onSetImportLock={handleSetRaceImportLock}
              />
            </div>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default App
