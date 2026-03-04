import { format, isAfter, parseISO } from "date-fns"

export function isPastIso(iso: string, nowIso?: string): boolean {
  const now = nowIso ? parseISO(nowIso) : new Date()
  return isAfter(now, parseISO(iso))
}

export function formatIso(iso: string, mask = "EEE HH:mm"): string {
  return format(parseISO(iso), mask)
}

export function nowIso(): string {
  return new Date().toISOString()
}
