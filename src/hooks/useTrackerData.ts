import { useEffect, useMemo, useState } from "react"

import {
  initializeTrackerData,
  subscribeBets,
  subscribeGlobalStats,
  subscribeRaces,
  subscribeUserStats,
  subscribeUsers,
} from "@/lib/firebase"
import type { Bet, GlobalStats, Race, UserProfile, UserStats } from "@/lib/types"

export function useTrackerData() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [races, setRaces] = useState<Race[]>([])
  const [bets, setBets] = useState<Bet[]>([])
  const [userStats, setUserStats] = useState<UserStats[]>([])
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)

  useEffect(() => {
    let mounted = true
    setBootstrapping(true)

    const unsubscribers = [
      subscribeUsers(setUsers),
      subscribeRaces(setRaces),
      subscribeBets(setBets),
      subscribeUserStats(setUserStats),
      subscribeGlobalStats(setGlobalStats),
    ]

    ;(async () => {
      try {
        await initializeTrackerData()
      } catch (bootstrapError) {
        if (mounted) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : "Failed to bootstrap season")
        }
      } finally {
        if (mounted) {
          setBootstrapping(false)
        }
      }
    })()

    return () => {
      mounted = false
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [])

  const value = useMemo(
    () => ({
      users,
      races,
      bets,
      userStats,
      globalStats,
      error,
      bootstrapping,
      setError,
    }),
    [users, races, bets, userStats, globalStats, error, bootstrapping],
  )

  return value
}
