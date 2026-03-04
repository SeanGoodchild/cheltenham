import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

function walk(dir) {
  const entries = readdirSync(dir)
  const files = []
  for (const entry of entries) {
    const absolute = join(dir, entry)
    const stats = statSync(absolute)
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") {
        continue
      }
      files.push(...walk(absolute))
      continue
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      files.push(absolute)
    }
  }
  return files
}

const files = [...walk("api"), ...walk("server")]

const importRegex =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']|\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g
const allowedExtensions = [".js", ".mjs", ".cjs", ".json", ".node"]
const errors = []

for (const file of files) {
  const source = readFileSync(file, "utf8")
  for (const match of source.matchAll(importRegex)) {
    const specifier = match[1] ?? match[2]
    if (!specifier) {
      continue
    }

    if (allowedExtensions.some((ext) => specifier.endsWith(ext))) {
      continue
    }

    errors.push(`${file}: relative import must use runtime extension (.js/.mjs/.json) -> ${specifier}`)
  }
}

if (errors.length > 0) {
  console.error("ESM relative import check failed:\n")
  errors.forEach((line) => console.error(`- ${line}`))
  process.exit(1)
}

console.log(`ESM relative import check passed (${files.length} files scanned).`)
