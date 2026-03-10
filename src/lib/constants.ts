import type { Race, UserProfile } from "./types"

export const FIRESTORE_ROOT = "cl"
export const CURRENT_SEASON = "2026"
export const APP_TIMEZONE = "Europe/London"

export const DEFAULT_USERS: UserProfile[] = [
  { id: "fabs", displayName: "Fabs", isActive: true },
  { id: "ru", displayName: "Ru", isActive: true },
  { id: "shiblen", displayName: "Shiblen", isActive: true },
  { id: "howes", displayName: "Howes", isActive: true },
  { id: "grandad_packet", displayName: "Grandad Packet", isActive: true },
  { id: "steve", displayName: "Steve", isActive: true },
  { id: "sean", displayName: "Sean", isActive: true },
  { id: "gordo", displayName: "Gordo", isActive: true },
  { id: "tim", displayName: "Tim", isActive: true },
  { id: "wilks", displayName: "Wilks", isActive: true },
]

const sampleDate = "2026-03-10"

export const SAMPLE_RACES: Array<Omit<Race, "id" | "result">> = [
  {
    season: CURRENT_SEASON,
    day: "Tuesday",
    offTime: `${sampleDate}T13:30:00.000Z`,
    course: "Cheltenham",
    name: "Supreme Novices' Hurdle",
    runners: ["Constitution Hill", "Captain Teague", "Favour And Fortune"],
    status: "scheduled",
    lifecycle: "upcoming",
  },
  {
    season: CURRENT_SEASON,
    day: "Tuesday",
    offTime: `${sampleDate}T14:10:00.000Z`,
    course: "Cheltenham",
    name: "Arkle Challenge Trophy",
    runners: ["Jonbon", "El Fabiolo", "Gaelic Warrior"],
    status: "scheduled",
    lifecycle: "upcoming",
  },
]

export const EMPTY_RACE_RESULT = {
  winner: undefined,
  placed: [],
  source: "manual" as const,
  updatedAt: undefined,
}
