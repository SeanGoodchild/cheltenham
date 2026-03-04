import { Readable } from "node:stream"

import { handleApiRequest } from "../server/index"

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.join(", ")
  }
  return typeof value === "string" ? value : null
}

async function readRequestBody(req: {
  method?: string
  body?: unknown
  [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>
}): Promise<Uint8Array | undefined> {
  const method = String(req.method ?? "GET").toUpperCase()
  if (method === "GET" || method === "HEAD") {
    return undefined
  }

  if (req.body !== undefined && req.body !== null) {
    if (req.body instanceof Uint8Array) {
      return req.body
    }
    if (typeof req.body === "string") {
      return new TextEncoder().encode(req.body)
    }
    return new TextEncoder().encode(JSON.stringify(req.body))
  }

  if (!req[Symbol.asyncIterator]) {
    return undefined
  }

  const chunks: Uint8Array[] = []
  for await (const chunk of req as AsyncIterable<unknown>) {
    if (chunk instanceof Uint8Array) {
      chunks.push(chunk)
    } else if (typeof chunk === "string") {
      chunks.push(new TextEncoder().encode(chunk))
    }
  }

  if (chunks.length === 0) {
    return undefined
  }

  const total = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    merged.set(chunk, offset)
    offset += chunk.length
  })
  return merged
}

function toFetchRequest(
  req: {
    method?: string
    url?: string
    headers?: Record<string, string | string[] | undefined>
  },
  body: Uint8Array | undefined,
): Request {
  const headers = new Headers()
  Object.entries(req.headers ?? {}).forEach(([name, value]) => {
    const normalized = normalizeHeaderValue(value)
    if (normalized !== null) {
      headers.set(name, normalized)
    }
  })

  const proto = normalizeHeaderValue(req.headers?.["x-forwarded-proto"])?.split(",")[0]?.trim() ?? "https"
  const host =
    normalizeHeaderValue(req.headers?.["x-forwarded-host"]) ??
    normalizeHeaderValue(req.headers?.host) ??
    "localhost"
  const rawUrl = req.url ?? "/api/health"
  const url = new URL(rawUrl, `${proto}://${host}`)
  const rewrittenPath = url.searchParams.get("path")
  if (rewrittenPath) {
    url.pathname = `/api/${rewrittenPath}`.replace(/\/+/g, "/")
    url.searchParams.delete("path")
  }

  const method = String(req.method ?? "GET").toUpperCase()
  const init: RequestInit = { method, headers }
  if (body && method !== "GET" && method !== "HEAD") {
    init.body = body
  }

  return new Request(url.toString(), init)
}

async function writeFetchResponse(
  res: {
    setHeader: (name: string, value: string) => void
    statusCode: number
    end: (chunk?: Uint8Array | Buffer | string) => void
  },
  response: Response,
) {
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.statusCode = response.status

  if (!response.body) {
    res.end()
    return
  }

  const nodeStream = Readable.fromWeb(response.body as unknown as ReadableStream)
  nodeStream.on("error", () => {
    res.end()
  })
  nodeStream.on("end", () => {
    res.end()
  })
  nodeStream.pipe(res as unknown as NodeJS.WritableStream, { end: false })
}

export default async function handler(
  req: {
    method?: string
    url?: string
    headers?: Record<string, string | string[] | undefined>
    body?: unknown
    [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>
  },
  res: {
    setHeader: (name: string, value: string) => void
    statusCode: number
    end: (chunk?: Uint8Array | Buffer | string) => void
  },
) {
  const body = await readRequestBody(req)
  const request = toFetchRequest(req, body)
  const response = await handleApiRequest(request)
  await writeFetchResponse(res, response)
}
