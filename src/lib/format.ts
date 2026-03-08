export type OddsFormat = "fractional" | "decimal"

const ODDS_FORMAT_STORAGE_KEY = "cheltenham.oddsFormat"

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const remainder = x % y
    x = y
    y = remainder
  }
  return x || 1
}

export function getStoredOddsFormat(): OddsFormat {
  if (typeof window === "undefined") {
    return "fractional"
  }

  const stored = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY)
  return stored === "decimal" ? "decimal" : "fractional"
}

export function persistOddsFormat(format: OddsFormat): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(ODDS_FORMAT_STORAGE_KEY, format)
}

function formatFractionalOdds(value: number): string {
  if (!Number.isFinite(value) || value < 1) {
    return "-"
  }

  const fractional = value - 1
  if (Math.abs(fractional) < 0.0001) {
    return "0/1"
  }

  let bestNumerator = Math.round(fractional)
  let bestDenominator = 1
  let bestError = Math.abs(fractional - bestNumerator / bestDenominator)

  for (let denominator = 1; denominator <= 32; denominator += 1) {
    const numerator = Math.round(fractional * denominator)
    const estimate = numerator / denominator
    const error = Math.abs(fractional - estimate)
    if (error < bestError) {
      bestNumerator = numerator
      bestDenominator = denominator
      bestError = error
    }
  }

  const divisor = gcd(bestNumerator, bestDenominator)
  const reducedNumerator = bestNumerator / divisor
  const reducedDenominator = bestDenominator / divisor

  return `${reducedNumerator}/${reducedDenominator}`
}

export function formatOdds(value: number, format: OddsFormat = getStoredOddsFormat()): string {
  if (!Number.isFinite(value) || value < 1) {
    return "-"
  }

  if (format === "decimal") {
    return value.toFixed(2)
  }

  return formatFractionalOdds(value)
}

export function formatMarketOdds(
  bestFractional: string,
  bestDecimal: number,
  format: OddsFormat = getStoredOddsFormat(),
): string {
  if (format === "decimal") {
    return formatOdds(bestDecimal, "decimal")
  }

  return bestFractional || formatOdds(bestDecimal, "fractional")
}
