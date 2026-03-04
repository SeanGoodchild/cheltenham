import { useEffect, useMemo, useState } from "react"

import { AdminPanel } from "@/components/tracker/AdminPanel"
import { BetPanel, type BetDraftForm } from "@/components/tracker/BetPanel"
import { MainBoard } from "@/components/tracker/MainBoard"
import { PersonalPanel } from "@/components/tracker/PersonalPanel"
import { StatsCards } from "@/components/tracker/StatsCards"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

const USER_STORAGE_KEY = "cheltenham.selectedUser"
type AppTab = "new-bet" | "main-cashboard" | "user-summary"

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

  const resolvedSelectedUserId = users.some((user) => user.id === selectedUserId)
    ? selectedUserId
    : (users[0]?.id ?? "")

  const selectedUser = users.find((user) => user.id === resolvedSelectedUserId)
  const selectedUserStats = derivedUserStats.find((entry) => entry.userId === resolvedSelectedUserId)

  const persistUserId = (value: string) => {
    setSelectedUserId(value)
    window.localStorage.setItem(USER_STORAGE_KEY, value)
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
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to refresh race data")
    } finally {
      setRefreshingRaceData(false)
    }
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
    <main className="mx-auto min-h-screen max-w-[1400px] space-y-5 p-4 md:p-6">
      <header className="rounded-xl border border-border bg-card px-5 py-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cheltenham Festival 2026</div>
            <h1 className="mt-1 text-3xl font-semibold md:text-4xl">Cheltenham Bet Tracker</h1>
          </div>
          <Badge variant="secondary">Dark Mode</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Live group tracking with clean tabs for bets, cashboard, and personal performance.
        </p>
      </header>

      <Card>
        <CardContent className="py-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              type="button"
              variant={activeTab === "new-bet" ? "default" : "outline"}
              onClick={() => setActiveTab("new-bet")}
            >
              New Bet
            </Button>
            <Button
              type="button"
              variant={activeTab === "main-cashboard" ? "default" : "outline"}
              onClick={() => setActiveTab("main-cashboard")}
            >
              Main Cashboard
            </Button>
            <Button
              type="button"
              variant={activeTab === "user-summary" ? "default" : "outline"}
              onClick={() => setActiveTab("user-summary")}
            >
              User Summary
            </Button>
          </div>
        </CardContent>
      </Card>

      {(error || actionError) && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error ?? actionError}</CardContent>
        </Card>
      )}

      {activeTab === "new-bet" ? (
        <BetPanel
          users={users}
          races={races}
          bets={bets}
          selectedUserId={resolvedSelectedUserId}
          onSelectUserId={persistUserId}
          onCreateBet={handleCreateBet}
          onUpdateBet={handleUpdateBet}
          onDeleteBet={handleDeleteBet}
        />
      ) : null}

      {activeTab === "main-cashboard" ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="text-sm text-muted-foreground">
                Last refreshed:{" "}
                {raceImportRun?.completedAt
                  ? `${formatIso(raceImportRun.completedAt, "EEE d MMM HH:mm")} (${raceImportRun.status})`
                  : raceImportRun?.startedAt
                    ? `${formatIso(raceImportRun.startedAt, "EEE d MMM HH:mm")} (${raceImportRun.status})`
                    : "Never"}
              </div>
              <Button type="button" onClick={handleRefreshRaceData} disabled={refreshingRaceData}>
                {refreshingRaceData ? "Refreshing..." : "Refresh race data"}
              </Button>
            </CardContent>
          </Card>
          <StatsCards title="Main Cashboard" stats={derivedGlobalStats} />
          <MainBoard bets={bets} users={users} races={races} stats={derivedUserStats} />
          <details className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
            <summary className="cursor-pointer text-sm font-medium">Admin Actions</summary>
            <div className="mt-3">
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
          </details>
        </div>
      ) : null}

      {activeTab === "user-summary" ? (
        <PersonalPanel user={selectedUser} userStats={selectedUserStats} bets={bets} races={races} />
      ) : null}
    </main>
  )
}

export default App
