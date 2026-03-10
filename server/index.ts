import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { readFile } from "node:fs/promises"

import {
  APP_TIMEZONE,
  CURRENT_SEASON,
  DEFAULT_USERS,
  EMPTY_RACE_RESULT,
  FIRESTORE_ROOT,
} from "../src/lib/constants.js"
import {
  parseSportingLifeRacePageHtml,
  parseSportingLifeRaceUrl,
} from "../src/lib/sportingLife.js"
import {
  buildGeminiRaceResultNotificationSummary,
  buildGeminiRaceResultNotificationText,
  buildGeminiTrackerSummaryText,
} from "../src/lib/geminiSummary.js"
import type {
  Bet,
  BetLeg,
  BetStatus,
  BetType,
  EwTerms,
  GlobalStats,
  LegResult,
  Race,
  RaceDay,
  RaceImportRun,
  UserProfile,
  UserStats,
} from "../src/lib/types.js"

const PORT = Number(process.env.PORT ?? 3001)
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:5173"
const IMPORT_LOCK_STALE_MINUTES = Number(process.env.IMPORT_LOCK_STALE_MINUTES ?? 10)
const SPORTING_LIFE_IMPORT_TIMEOUT_MS = Number(process.env.SPORTING_LIFE_IMPORT_TIMEOUT_MS ?? 8000)
const SPORTING_LIFE_USER_AGENT =
  process.env.SPORTING_LIFE_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
const SPORTING_LIFE_RACE_URLS_FILE = new URL("../public/race_urls.txt", import.meta.url)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? ""
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID?.trim() ?? ""
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? ""
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? ""
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview"
const GEMINI_RATE_LIMIT_MAX_REQUESTS = 20
const GEMINI_RATE_LIMIT_WINDOW_MS = 60_000
const TELEGRAM_DEFAULT_SUMMARY_PROMPT = "How are things going in the Cheltenham tracker right now?"
const GEMINI_SYSTEM_INSTRUCTION = `You are a friendly bot for a Telegram group following Cheltenham horse racing and tracking their betting results.

You may be given a tracker summary with current app state such as bets, toots, standings, P&L, open stakes, and upcoming races. Use that information when it is relevant to the user's question, but do not force every reply to mention the next race or other tracker details if they are not helpful.
If a user asks something broad like "How are things going?", interpret it as a question about the current Cheltenham tracker state.
Prefer concrete names and numbers from the provided context when useful.
Keep replies concise, natural, and conversational for a Telegram group, usually 1 to 4 short sentences.
It is fine to refer to bets as "toots" occasionally, but do not overdo the slang or repeat "Lads" unnaturally.
If the context does not contain the answer, say so briefly and do not invent details.
Avoid markdown or other formatting - your response text will be sent as a plain string to Telegram.
Users may ask about themselves or other users, you can check their name (provided in the sender context) to help disambiguate "How am I doing?" vs "How is Liam doing?" for example.
However there's a mapping due to nicknames. Telegram First Name -> Tracker User: Fabian -> Fabs, Liam -> Gordo, Josh or Joshua -> Grandad Packet, Dan -> Steve, Tom -> Howes, Simon -> Shiblen.
The group as a whole goes by the name 'Cash Lads' or 'CLs' for short.
If you detect that the message is insincere, or making a joke rather than a genuine ask, you can respond simply with only the water pistol emoji 🔫.
If web search would materially improve the answer, you may use it. If the user asks for links or sources, include direct source URLs in the answer text when you can. Do not rely on internal Google grounding URLs.
If asked for tips, you can search https://www.racingpost.com/horse-racing-tips/ to see what the tipsters are saying. Make it sound like your own ideas & justification.`

const GEMINI_RACE_RESULT_SYSTEM_INSTRUCTION = `You are writing a short Telegram post for the Cash Lads group immediately after a Cheltenham race has been settled.

You will be given structured tracker context focused on the just-settled race, current standings, and the next race.
Summarise what happened in the last race, who won or lost money on it, the running overall picture, and the details of the next race when useful.
Prefer concrete names and numbers from the provided context.
Keep it punchy and readable for a group chat, usually 2 to 4 short sentences.
Do not invent details that are missing from the context.
Do not mention JSON or say "based on the context".
Avoid markdown or other formatting - your response text will be sent as a plain string to Telegram.
If nobody had a toot on the settled race, say that briefly and move on to the standings or next race.`

type TrackerState = {
  users: UserProfile[]
  races: Race[]
  bets: Bet[]
  userStats: UserStats[]
  globalStats: GlobalStats | null
  version: string
}

type BetDraftInput = {
  userId: string
  betType: BetType
  betName?: string
  legs: Array<{
    raceId: string
    selectionName: string
    decimalOdds?: number | null
    horseUid?: number
  }>
  stakeTotal: number
  isFreeBet?: boolean
  oddsUsed?: number | null
  ewTerms?: EwTerms
}

type ManualOtherSettleInput = {
  totalReturn: number
}

type TestRaceMessageInput = {
  raceId?: string
}

type TelegramSendMessageInput = {
  chatId: string | number
  text: string
  replyToMessageId?: number
}

type TelegramWebhookUpdate = {
  update_id?: number
  message?: {
    message_id?: number
    text?: string
    chat?: {
      id?: number
      type?: string
      title?: string
    }
    entities?: Array<{
      type?: string
      offset?: number
      length?: number
    }>
    from?: {
      id?: number
      is_bot?: boolean
      username?: string
      first_name?: string
      last_name?: string
    }
    reply_to_message?: {
      message_id?: number
      text?: string
      from?: {
        id?: number
        is_bot?: boolean
        username?: string
        first_name?: string
        last_name?: string
      }
    }
  }
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
    finishReason?: string
  }>
  promptFeedback?: {
    blockReason?: string
  }
}

type TelegramGetMeResponse = {
  ok?: boolean
  result?: {
    username?: string
  }
  description?: string
}

type GenerateGeminiReplyOptions = {
  systemInstruction?: string
  enableSearch?: boolean
  temperature?: number
  maxOutputTokens?: number
}

const geminiRequestTimestamps: number[] = []
let telegramBotUsernamePromise: Promise<string> | null = null

type RaceImportSummary = {
  racesInserted: number
  racesUpdated: number
  racesSkippedLocked: number
  runnersChanged: number
  nonRunnersDetected: number
  legsAutoVoided: number
  racesAutoSettled: number
  oddsRacesAttempted: number
  oddsRacesUpdated: number
  oddsRacesFailed: number
  oddsRowsParsed: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function initFirestore(): Firestore {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID ?? "rocketmill-octane"
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON

  if (getApps().length === 0) {
    if (serviceAccountRaw) {
      initializeApp({
        credential: cert(JSON.parse(serviceAccountRaw)),
        projectId,
      })
    } else {
      initializeApp({
        credential: applicationDefault(),
        projectId,
      })
    }
  }

  return getFirestore()
}

let dbInitError: Error | null = null
const db: Firestore = (() => {
  try {
    const firestore = initFirestore()
    firestore.settings({ ignoreUndefinedProperties: true })
    return firestore
  } catch (error) {
    dbInitError = error instanceof Error ? error : new Error(String(error))
    console.error("firestore init failed", dbInitError)
    return new Proxy({} as Firestore, {
      get() {
        throw dbInitError ?? new Error("Firestore init failed")
      },
    })
  }
})()

function seasonDoc(firestore: Firestore) {
  return firestore.collection(FIRESTORE_ROOT).doc(CURRENT_SEASON)
}

function usersCol(firestore: Firestore) {
  return seasonDoc(firestore).collection("users")
}

function racesCol(firestore: Firestore) {
  return seasonDoc(firestore).collection("races")
}

function betsCol(firestore: Firestore) {
  return seasonDoc(firestore).collection("bets")
}

function userStatsCol(firestore: Firestore) {
  return seasonDoc(firestore).collection("stats_users")
}

function globalStatsDoc(firestore: Firestore) {
  return seasonDoc(firestore).collection("stats_global").doc("overview")
}

function eventsCol(firestore: Firestore) {
  return seasonDoc(firestore).collection("events")
}

function notificationsCol(firestore: Firestore) {
  return seasonDoc(firestore).collection("notifications")
}

function jobsCol(firestore: Firestore) {
  return seasonDoc(firestore).collection("jobs")
}

function importJobsCol(firestore: Firestore) {
  return seasonDoc(firestore).collection("import_jobs")
}

function normalizeHorseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function formatHorseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function sanitizeRaceName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    return ""
  }

  const cutoffIndex = trimmed.search(/[([]/)
  const cleaned = (cutoffIndex >= 0 ? trimmed.slice(0, cutoffIndex) : trimmed).trim()
  return cleaned || trimmed
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function isValidOdds(value: number | undefined | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
}

function getBetRiskStake(bet: Pick<Bet, "stakeTotal" | "isFreeBet">): number {
  return bet.isFreeBet ? 0 : bet.stakeTotal
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function formatMoneyGBP(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatRaceTimeForMessage(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return "TBC"
  }
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TIMEZONE,
  }).format(date)
}

function toRaceDay(iso: string): RaceDay {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: APP_TIMEZONE,
  }).format(new Date(iso))
  if (weekday === "Tuesday" || weekday === "Wednesday" || weekday === "Thursday" || weekday === "Friday") {
    return weekday
  }
  return "Tuesday"
}

function runnerToDisplayName(name: string): string {
  return formatHorseName(name)
}

async function sendTelegramMessage(input: TelegramSendMessageInput): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram not configured (missing TELEGRAM_BOT_TOKEN)")
  }

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text,
      disable_web_page_preview: true,
      reply_to_message_id: input.replyToMessageId,
    }),
  })

  const responseBody = await response.text()
  if (!response.ok) {
    throw new Error(`Telegram send failed (${response.status}): ${responseBody.slice(0, 300)}`)
  }

  const payload = JSON.parse(responseBody) as { ok?: boolean; description?: string }
  if (!payload.ok) {
    throw new Error(`Telegram rejected message: ${payload.description ?? "unknown error"}`)
  }
}

async function sendTelegramNotificationMessage(text: string): Promise<void> {
  if (!TELEGRAM_CHAT_ID) {
    throw new Error("Telegram not configured (missing TELEGRAM_CHAT_ID)")
  }

  await sendTelegramMessage({
    chatId: TELEGRAM_CHAT_ID,
    text,
  })
}

function trimTelegramReply(text: string): string {
  const normalized = text.trim()
  if (!normalized) {
    return "No response."
  }

  if (normalized.length <= 4000) {
    return normalized
  }

  return `${normalized.slice(0, 3997)}...`
}

function applyTelegramSenderReplyFormatting(
  reply: string,
  sender?: { first_name?: string | undefined } | null,
): string {
  if (sender?.first_name?.trim().toLowerCase() !== "liam") {
    return reply
  }

  return reply.replace(/£/g, "£000000")
}

function reserveGeminiRequestSlot(now = Date.now()): boolean {
  while (
    geminiRequestTimestamps.length > 0 &&
    now - (geminiRequestTimestamps[0] ?? 0) >= GEMINI_RATE_LIMIT_WINDOW_MS
  ) {
    geminiRequestTimestamps.shift()
  }

  if (geminiRequestTimestamps.length >= GEMINI_RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  geminiRequestTimestamps.push(now)
  return true
}

async function getTelegramBotUsername(): Promise<string> {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram not configured (missing TELEGRAM_BOT_TOKEN)")
  }

  if (!telegramBotUsernamePromise) {
    telegramBotUsernamePromise = (async () => {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`)
      const responseBody = await response.text()
      if (!response.ok) {
        throw new Error(`Telegram getMe failed (${response.status}): ${responseBody.slice(0, 300)}`)
      }

      const payload = JSON.parse(responseBody) as TelegramGetMeResponse
      const username = payload.result?.username?.trim()
      if (!payload.ok || !username) {
        throw new Error(`Telegram getMe missing username: ${payload.description ?? "unknown error"}`)
      }
      return username
    })().catch((error) => {
      telegramBotUsernamePromise = null
      throw error
    })
  }

  return telegramBotUsernamePromise
}

function stripTelegramTriggerText(text: string, botUsername: string): string {
  let cleaned = text.trim()
  const mentionPattern = new RegExp(`@${botUsername}\\b`, "ig")
  cleaned = cleaned.replace(mentionPattern, "").replace(/\s+/g, " ").trim()
  return cleaned
}

function shouldRespondToTelegramMessage(
  message: NonNullable<TelegramWebhookUpdate["message"]>,
  botUsername: string,
): boolean {
  const chatType = message.chat?.type ?? ""
  if (chatType === "private") {
    return true
  }

  if (message.reply_to_message?.from?.is_bot) {
    return true
  }

  const text = message.text?.trim() ?? ""
  if (!text) {
    return false
  }

  return new RegExp(`@${botUsername}\\b`, "i").test(text)
}

function buildTelegramPromptInput(
  message: NonNullable<TelegramWebhookUpdate["message"]>,
  botUsername: string,
): string {
  const cleaned = stripTelegramTriggerText(message.text?.trim() ?? "", botUsername)
  return cleaned || TELEGRAM_DEFAULT_SUMMARY_PROMPT
}

function buildTelegramConversationContext(message: NonNullable<TelegramWebhookUpdate["message"]>): string | null {
  const replyText = message.reply_to_message?.text?.trim()
  if (!replyText) {
    return null
  }

  const replySender = [
    message.reply_to_message?.from?.first_name?.trim(),
    message.reply_to_message?.from?.last_name?.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    || message.reply_to_message?.from?.username?.trim()
    || "previous sender"
  return `Reply context:
The user is replying to a previous Telegram message from ${replySender}: "${replyText}"`
}

function buildTelegramSenderContext(message: NonNullable<TelegramWebhookUpdate["message"]>): string | null {
  const senderName = [message.from?.first_name?.trim(), message.from?.last_name?.trim()].filter(Boolean).join(" ")
  const username = message.from?.username?.trim()
  if (!senderName && !username) {
    return null
  }

  if (senderName && username) {
    return `Sender: ${senderName} (@${username})`
  }
  return `Sender: ${senderName || `@${username}`}`
}

async function buildTrackerSummaryText(): Promise<string> {
  const state = currentState ?? (await loadState())
  return buildGeminiTrackerSummaryText(state, nowIso())
}

async function loadTrackerStateSnapshot(): Promise<Pick<TrackerState, "users" | "races" | "bets">> {
  const [users, races, bets] = await Promise.all([getUsers(), getRaces(), getBets()])
  return { users, races, bets }
}

async function generateGeminiReply(
  prompt: string,
  trackerSummary: string,
  senderContext?: string | null,
  conversationContext?: string | null,
  options?: GenerateGeminiReplyOptions,
): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini not configured (missing GEMINI_API_KEY)")
  }

  if (!reserveGeminiRequestSlot()) {
    throw new Error("Gemini rate limit exceeded")
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: options?.systemInstruction ?? GEMINI_SYSTEM_INSTRUCTION }],
        },
        ...(options?.enableSearch === false ? {} : { tools: [{ google_search: {} }] }),
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Tracker context:
${trackerSummary}

${senderContext ? `${senderContext}

` : ""}${conversationContext ? `${conversationContext}

` : ""}User message:
${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: options?.temperature ?? 0.4,
          maxOutputTokens: options?.maxOutputTokens ?? 220,
        },
      }),
    },
  )

  const responseBody = await response.text()
  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}): ${responseBody.slice(0, 300)}`)
  }

  const payload = JSON.parse(responseBody) as GeminiGenerateContentResponse
  const reply =
    payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")
      .trim() ?? ""

  if (!reply) {
    const blockReason = payload.promptFeedback?.blockReason
    if (blockReason) {
      throw new Error(`Gemini blocked the prompt: ${blockReason}`)
    }
    throw new Error("Gemini returned an empty response")
  }

  return trimTelegramReply(reply)
}

function buildRaceResultFallbackMessage(
  summary: ReturnType<typeof buildGeminiRaceResultNotificationSummary>,
  options?: { isTest?: boolean },
): string {
  const users = Object.values(summary.race.users).sort((a, b) => {
    if (a.profitLoss !== b.profitLoss) {
      return b.profitLoss - a.profitLoss
    }
    return a.displayName.localeCompare(b.displayName)
  })
  const topRaceWinner = users.find((user) => user.profitLoss > 0)
  const topRaceLoser = [...users].reverse().find((user) => user.profitLoss < 0)
  const leader = summary.standings[0]
  const introPrefix = options?.isTest ? "[TEST] " : ""

  return [
    `${introPrefix}${summary.race.name} is settled. Winner: ${summary.race.winner ?? "unknown"}.`,
    topRaceWinner || topRaceLoser
      ? `On this race: ${topRaceWinner ? `${topRaceWinner.displayName} led with ${formatMoneyGBP(topRaceWinner.profitLoss)}.` : ""}${topRaceWinner && topRaceLoser ? " " : ""}${topRaceLoser ? `${topRaceLoser.displayName} dropped ${formatMoneyGBP(Math.abs(topRaceLoser.profitLoss))}.` : ""}`
      : "On this race: no tracked swing.",
    leader
      ? `${leader.displayName} now leads overall at ${formatMoneyGBP(leader.profitLoss)}.`
      : "Overall lead: none.",
    summary.nextRace
      ? `Next race is ${summary.nextRace.name} at ${formatRaceTimeForMessage(summary.nextRace.offTime)}.`
      : "No next race is scheduled.",
  ].join("\n\n")
}

async function generateRaceResultTelegramMessage(
  raceId: string,
  options?: { isTest?: boolean },
): Promise<{ message: string; summary: ReturnType<typeof buildGeminiRaceResultNotificationSummary> }> {
  const state = await loadTrackerStateSnapshot()
  const summary = buildGeminiRaceResultNotificationSummary(state, raceId, nowIso())
  const trackerSummary = buildGeminiRaceResultNotificationText(state, raceId, nowIso())

  try {
    const message = await generateGeminiReply(
      options?.isTest ? "Write a test-mode post-race Telegram update for this settled race." : "Write the post-race Telegram update for the group.",
      trackerSummary,
      null,
      null,
      {
        systemInstruction: GEMINI_RACE_RESULT_SYSTEM_INSTRUCTION,
        enableSearch: false,
        temperature: 0.5,
        maxOutputTokens: 180,
      },
    )

    return {
      message: options?.isTest ? `[TEST] ${message}` : message,
      summary,
    }
  } catch (error) {
    console.error("race result gemini message failed", error)
    return {
      message: buildRaceResultFallbackMessage(summary, options),
      summary,
    }
  }
}

async function handleTelegramWebhook(request: Request): Promise<Response> {
  if (!TELEGRAM_BOT_TOKEN) {
    return errorResponse("Telegram not configured (missing TELEGRAM_BOT_TOKEN)", 503)
  }

  if (!TELEGRAM_WEBHOOK_SECRET) {
    return errorResponse("Telegram webhook not configured (missing TELEGRAM_WEBHOOK_SECRET)", 503)
  }

  const secret = request.headers.get("x-telegram-bot-api-secret-token")?.trim() ?? ""
  if (secret !== TELEGRAM_WEBHOOK_SECRET) {
    return errorResponse("Invalid Telegram webhook secret", 401)
  }

  const update = await parseJson<TelegramWebhookUpdate>(request)
  const message = update.message
  const chatId = message?.chat?.id
  const messageId = message?.message_id
  const text = message?.text?.trim() ?? ""

  if (!chatId || !messageId) {
    return jsonResponse({ ok: true, ignored: true, reason: "no_message" })
  }

  if (message.from?.is_bot) {
    return jsonResponse({ ok: true, ignored: true, reason: "bot_message" })
  }

  if (!text) {
    return jsonResponse({ ok: true, ignored: true, reason: "no_text" })
  }

  const botUsername = await getTelegramBotUsername()
  if (!shouldRespondToTelegramMessage(message, botUsername)) {
    return jsonResponse({ ok: true, ignored: true, reason: "not_addressed_to_bot" })
  }

  let replyText = ""
  try {
    const trackerSummary = await buildTrackerSummaryText()
    const promptInput = buildTelegramPromptInput(message, botUsername)
    const senderContext = buildTelegramSenderContext(message)
    const conversationContext = buildTelegramConversationContext(message)
    replyText = await generateGeminiReply(promptInput, trackerSummary, senderContext, conversationContext)
  } catch (error) {
    console.error("telegram webhook gemini reply failed", error)
    replyText =
      error instanceof Error && error.message === "Gemini rate limit exceeded"
        ? "Too many requests just now. Try again in a minute."
        : "Sorry, I couldn't generate a reply just now."
  }

  replyText = applyTelegramSenderReplyFormatting(replyText, message.from)

  await sendTelegramMessage({
    chatId,
    text: replyText,
    replyToMessageId: messageId,
  })

  return jsonResponse({ ok: true, replied: true, model: GEMINI_MODEL })
}

async function dispatchRaceResultTelegramNotification(
  notificationId: string,
  race: Race,
  settledAt: string,
  options?: { isTest?: boolean },
): Promise<void> {
  const { message, summary } = await generateRaceResultTelegramMessage(race.id, options)

  try {
    await sendTelegramNotificationMessage(message)
    await notificationsCol(db)
      .doc(notificationId)
      .set(
        {
          status: "sent",
          updatedAt: nowIso(),
          payload: {
            raceId: race.id,
            raceName: race.name,
            winner: race.result.winner,
            settledAt,
            summary,
            message,
          },
          error: null,
          processingAt: null,
        },
        { merge: true },
      )
    await writeEvent(options?.isTest ? "telegram_sent_test_race_result" : "telegram_sent_race_result", {
      notificationId,
      raceId: race.id,
    })
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error)
    const notificationSnapshot = await notificationsCol(db).doc(notificationId).get()
    const notificationRaw = (notificationSnapshot.data() as Record<string, unknown> | undefined) ?? {}
    await notificationsCol(db)
      .doc(notificationId)
      .set(
        {
          status: "failed",
          error: failureMessage,
          retries: Number(notificationRaw.retries ?? 0) + 1,
          updatedAt: nowIso(),
          payload: {
            raceId: race.id,
            raceName: race.name,
            winner: race.result.winner,
            settledAt,
            summary,
            message,
          },
          processingAt: null,
        },
        { merge: true },
      )
    await writeEvent(options?.isTest ? "telegram_failed_test_race_result" : "telegram_failed_race_result", {
      notificationId,
      raceId: race.id,
      error: failureMessage,
    })
  }
}

async function claimRaceResultNotificationDispatch(
  race: Race,
  settledAt: string,
): Promise<{ notificationId: string; shouldSend: boolean }> {
  const notificationRef = notificationsCol(db).doc(`race_result_${race.id}`)
  const claimedAt = nowIso()
  const staleProcessingMs = 5 * 60 * 1000

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(notificationRef)
    const raw = (snapshot.data() as Record<string, unknown> | undefined) ?? {}
    const status = typeof raw.status === "string" ? raw.status : "pending"
    const processingAt = typeof raw.processingAt === "string" ? raw.processingAt : undefined
    const processingFresh =
      processingAt !== undefined && Date.now() - new Date(processingAt).getTime() < staleProcessingMs

    if (status === "sent" || processingFresh) {
      return { notificationId: notificationRef.id, shouldSend: false }
    }

    transaction.set(
      notificationRef,
      {
        id: notificationRef.id,
        eventType: "race_result_settled",
        payload: {
          raceId: race.id,
          raceName: race.name,
          winner: race.result.winner,
          settledAt,
        },
        status: "pending",
        error: null,
        processingAt: claimedAt,
        retries: Number(raw.retries ?? 0),
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : claimedAt,
        updatedAt: claimedAt,
      },
      { merge: true },
    )

    return { notificationId: notificationRef.id, shouldSend: true }
  })
}

async function sendTestRaceResultTelegram(input: TestRaceMessageInput): Promise<{
  notificationId: string
  raceId: string
  raceName: string
  status: NotificationLog["status"]
  error?: string
}> {
  const races = await getRaces()
  const requestedRaceId = input.raceId?.trim()
  const selectedRace =
    (requestedRaceId ? races.find((race) => race.id === requestedRaceId) : undefined) ??
    races
      .filter((race) => race.status === "settled")
      .sort((a, b) => new Date(b.offTime).getTime() - new Date(a.offTime).getTime())[0] ??
    races.sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())[0]

  if (!selectedRace) {
    throw new Error("No races available for test notification")
  }

  const now = nowIso()
  const notificationRef = notificationsCol(db).doc()
  await notificationRef.set({
    id: notificationRef.id,
    eventType: "race_result_settled",
    payload: {
      raceId: selectedRace.id,
      raceName: selectedRace.name,
      winner: selectedRace.result.winner,
      settledAt: now,
      test: true,
    },
    status: "pending",
    retries: 0,
    createdAt: now,
    updatedAt: now,
  })

  await dispatchRaceResultTelegramNotification(notificationRef.id, selectedRace, now, { isTest: true })

  const finalSnapshot = await notificationRef.get()
  const raw = (finalSnapshot.data() as Record<string, unknown> | undefined) ?? {}
  const status = raw.status === "sent" || raw.status === "failed" ? raw.status : "pending"
  const error = typeof raw.error === "string" ? raw.error : undefined

  return {
    notificationId: notificationRef.id,
    raceId: selectedRace.id,
    raceName: selectedRace.name,
    status,
    error,
  }
}

function toStringHash(value: string): string {
  return String(Bun.hash(value))
}

function deriveLockAt(legs: Array<Pick<BetLeg, "raceId">>, races: Race[]): string {
  const times = legs
    .map((leg) => races.find((race) => race.id === leg.raceId)?.offTime)
    .filter((value): value is string => Boolean(value))

  if (!times.length) {
    throw new Error("Unable to derive lock time: one or more races are missing")
  }

  return times.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
}

function findRaceRunner(
  race: Race,
  selectionName: string,
  horseUid?: number,
): { horseUid?: number; horseName: string; nonRunner: boolean } | null {
  if (horseUid && race.runnersDetailed?.length) {
    const byUid = race.runnersDetailed.find((runner) => runner.horseUid === horseUid)
    if (byUid) {
      return byUid
    }
  }

  const normalizedSelection = normalizeHorseName(selectionName)
  if (race.runnersDetailed?.length) {
    const byName = race.runnersDetailed.find(
      (runner) => normalizeHorseName(runner.horseName) === normalizedSelection,
    )
    if (byName) {
      return byName
    }
  }

  if (race.runners.some((runner) => normalizeHorseName(runner) === normalizedSelection)) {
    return {
      horseName: selectionName,
      nonRunner: false,
    }
  }

  return null
}

function validateRunnerSelection(selectionName: string, race: Race, horseUid?: number): boolean {
  const runner = findRaceRunner(race, selectionName, horseUid)
  return Boolean(runner && !runner.nonRunner)
}

function deriveLegResult(selectionName: string, race: Race, horseUid?: number): LegResult {
  if (horseUid && race.runnersDetailed?.some((runner) => runner.horseUid === horseUid && runner.nonRunner)) {
    return "void"
  }

  const normalizedSelection = normalizeHorseName(selectionName)

  if (race.result.winner && normalizeHorseName(race.result.winner) === normalizedSelection) {
    return "win"
  }

  if (race.result.placed.some((entry) => normalizeHorseName(entry) === normalizedSelection)) {
    return "place"
  }

  if (!race.result.winner && race.result.placed.length === 0) {
    return "pending"
  }

  return "lose"
}

function deriveRaceLifecycle(
  offTimeIso: string,
  result: Pick<Race["result"], "winner" | "placed">,
  atIso: string,
): Race["lifecycle"] {
  if (result.winner || result.placed.length > 0) {
    return "complete"
  }
  if (new Date(offTimeIso).getTime() <= new Date(atIso).getTime()) {
    return "in_progress"
  }
  return "upcoming"
}

function getDerivedBetStatus(bet: Bet, atIso: string): BetStatus {
  if (bet.status === "settled" || bet.status === "void") {
    return bet.status
  }

  return new Date(atIso).getTime() > new Date(bet.lockAt).getTime() ? "locked" : "open"
}

function isBetSettleable(bet: Bet): boolean {
  if (bet.betType === "accumulator") {
    return bet.legs.some((leg) => leg.result === "lose") || bet.legs.every((leg) => leg.result !== "pending")
  }
  return bet.legs.every((leg) => leg.result !== "pending")
}

function calculateSingleReturn(stake: number, odds: number, legResult: LegResult, isFreeBet = false): number {
  if (legResult === "win") {
    return isFreeBet ? stake * Math.max(odds - 1, 0) : stake * odds
  }
  if (legResult === "void") {
    return isFreeBet ? 0 : stake
  }
  return 0
}

function calculateEachWayReturn(
  stakeTotal: number,
  odds: number,
  legResult: LegResult,
  placeFraction: number,
  isFreeBet = false,
): number {
  const winStake = stakeTotal / 2
  const placeStake = stakeTotal / 2

  const winReturn =
    legResult === "win"
      ? isFreeBet
        ? winStake * Math.max(odds - 1, 0)
        : winStake * odds
      : legResult === "void"
        ? isFreeBet
          ? 0
          : winStake
        : 0

  const placeOdds = 1 + (odds - 1) * placeFraction
  const placeReturn =
    legResult === "win" || legResult === "place"
      ? isFreeBet
        ? placeStake * Math.max(placeOdds - 1, 0)
        : placeStake * placeOdds
      : legResult === "void"
        ? isFreeBet
          ? 0
          : placeStake
        : 0

  return winReturn + placeReturn
}

function resolveBetOddsUsed(bet: Pick<Bet, "betType" | "oddsUsed" | "legs">): number | null {
  if (isValidOdds(bet.oddsUsed)) {
    return bet.oddsUsed
  }

  if (bet.betType === "accumulator") {
    if (!bet.legs.length) {
      return null
    }
    const combined = bet.legs.reduce((acc, leg) => {
      const odds = isValidOdds(leg.decimalOdds) ? leg.decimalOdds : 1
      return acc * odds
    }, 1)
    return isValidOdds(combined) ? roundMoney(combined) : null
  }

  if (bet.betType === "other") {
    return null
  }

  const firstLegOdds = bet.legs[0]?.decimalOdds
  return isValidOdds(firstLegOdds) ? firstLegOdds : null
}

function calculateAccumulatorReturn(
  stake: number,
  bet: Pick<Bet, "legs" | "oddsUsed" | "betType" | "isFreeBet">,
): number {
  const legs = bet.legs
  if (legs.some((leg) => leg.result === "lose")) {
    return 0
  }

  const allResolved = legs.every((leg) => leg.result !== "pending")
  if (!allResolved) {
    return 0
  }

  let combinedOdds = resolveBetOddsUsed(bet) ?? 1
  if (!isValidOdds(combinedOdds)) {
    combinedOdds = 1
  }

  const voidOddsFactor = legs.reduce((acc, leg) => {
    if (leg.result !== "void") {
      return acc
    }
    const legOdds = isValidOdds(leg.decimalOdds) ? leg.decimalOdds : 1
    return acc * legOdds
  }, 1)

  const adjustedOdds = Math.max(1, combinedOdds / Math.max(1, voidOddsFactor))
  return bet.isFreeBet ? stake * Math.max(adjustedOdds - 1, 0) : stake * adjustedOdds
}

function calculateBetReturn(bet: Bet): number {
  const firstLeg = bet.legs[0]
  if (!firstLeg) {
    return 0
  }

  const oddsUsed = resolveBetOddsUsed(bet)
  if (!isValidOdds(oddsUsed)) {
    return 0
  }

  if (bet.betType === "single" || bet.betType === "other") {
    return calculateSingleReturn(bet.stakeTotal, oddsUsed, firstLeg.result, bet.isFreeBet)
  }

  if (bet.betType === "each_way") {
    return calculateEachWayReturn(
      bet.stakeTotal,
      oddsUsed,
      firstLeg.result,
      bet.ewTerms?.placeFraction ?? 0.2,
      bet.isFreeBet,
    )
  }

  return calculateAccumulatorReturn(bet.stakeTotal, bet)
}

function computeUserStats(user: UserProfile, bets: Bet[]): UserStats {
  const userBets = bets.filter((bet) => bet.userId === user.id)
  const settledBets = userBets.filter((bet) => bet.status === "settled")
  const settledStaked = roundMoney(settledBets.reduce((acc, bet) => acc + getBetRiskStake(bet), 0))
  const oddsValues = userBets
    .map((bet) => resolveBetOddsUsed(bet))
    .filter((value): value is number => isValidOdds(value))
  const averageOdds =
    oddsValues.length > 0
      ? roundMoney(oddsValues.reduce((acc, value) => acc + value, 0) / oddsValues.length)
      : 0
  const totalStaked = roundMoney(userBets.reduce((acc, bet) => acc + bet.stakeTotal, 0))
  const totalReturns = roundMoney(settledBets.reduce((acc, bet) => acc + (bet.totalReturn ?? 0), 0))
  const profitLoss = roundMoney(totalReturns - settledStaked)
  const betsPlaced = userBets.length
  const settledWins = settledBets.filter((bet) => (bet.totalReturn ?? 0) > 0).length

  const roasPct = settledStaked > 0 ? roundMoney((totalReturns / settledStaked) * 100) : 0
  const winPct = settledBets.length > 0 ? roundMoney((settledWins / settledBets.length) * 100) : 0
  const biggestLoss = roundMoney(
    settledBets.reduce((acc, bet) => Math.min(acc, bet.profitLoss ?? 0), 0),
  )
  const biggestWin = roundMoney(
    settledBets.reduce((acc, bet) => Math.max(acc, bet.profitLoss ?? 0), 0),
  )
  const averageStake = betsPlaced > 0 ? roundMoney(totalStaked / betsPlaced) : 0

  return {
    userId: user.id,
    totalStaked,
    totalReturns,
    profitLoss,
    roasPct,
    winPct,
    betsPlaced,
    averageOdds,
    biggestLoss,
    biggestWin,
    averageStake,
  }
}

function computeGlobalStats(bets: Bet[], users: UserProfile[], atIso: string): GlobalStats {
  const byUser = users.map((user) => computeUserStats(user, bets))
  const oddsValues = bets
    .map((bet) => resolveBetOddsUsed(bet))
    .filter((value): value is number => isValidOdds(value))
  const totalStaked = roundMoney(byUser.reduce((acc, stat) => acc + stat.totalStaked, 0))
  const totalReturns = roundMoney(byUser.reduce((acc, stat) => acc + stat.totalReturns, 0))
  const betsPlaced = byUser.reduce((acc, stat) => acc + stat.betsPlaced, 0)
  const averageStake = betsPlaced > 0 ? roundMoney(totalStaked / betsPlaced) : 0
  const averageOdds =
    oddsValues.length > 0
      ? roundMoney(oddsValues.reduce((acc, value) => acc + value, 0) / oddsValues.length)
      : 0
  const settledBets = bets.filter((bet) => bet.status === "settled")
  const settledStaked = roundMoney(settledBets.reduce((acc, bet) => acc + getBetRiskStake(bet), 0))
  const settledWins = settledBets.filter((bet) => (bet.totalReturn ?? 0) > 0).length
  const roasPct = settledStaked > 0 ? roundMoney((totalReturns / settledStaked) * 100) : 0
  const winPct = settledBets.length > 0 ? roundMoney((settledWins / settledBets.length) * 100) : 0
  const biggestLoss = roundMoney(
    settledBets.reduce((acc, bet) => Math.min(acc, bet.profitLoss ?? 0), 0),
  )
  const biggestWinner = byUser.sort((a, b) => b.biggestWin - a.biggestWin)[0]

  return {
    totalStaked,
    totalReturns,
    averageStake,
    averageOdds,
    roasPct,
    winPct,
    betsPlaced,
    biggestLoss,
    biggestWin: biggestWinner?.biggestWin ?? 0,
    biggestWinUserId: biggestWinner?.userId,
    updatedAt: atIso,
  }
}

function mapRaceDoc(raw: Record<string, unknown>, id: string): Race {
  const resultRaw = (raw.result as Record<string, unknown> | undefined) ?? {}
  const importMetaRaw = (raw.importMeta as Record<string, unknown> | undefined) ?? {}
  const oddsMetaRaw = (raw.oddsMeta as Record<string, unknown> | undefined) ?? {}
  const importLockRaw = (raw.importLock as Record<string, unknown> | undefined) ?? {}
  const marketFavouriteRaw = (raw.marketFavourite as Record<string, unknown> | undefined) ?? {}
  const runnersDetailedRaw = Array.isArray(raw.runnersDetailed)
    ? raw.runnersDetailed
    : []
  const oddsSnapshotRaw = Array.isArray(raw.oddsSnapshot) ? raw.oddsSnapshot : []
  const runnersDetailed = runnersDetailedRaw
    .map((runner) => {
      const row = runner as Record<string, unknown>
      const horseUid = Number(row.horseUid ?? row.horse_uid)
      const horseName = String(row.horseName ?? row.horse_name ?? "")
      if (!horseName) {
        return null
      }
      return {
        horseUid: Number.isFinite(horseUid) ? horseUid : undefined,
        horseName,
        nonRunner: Boolean(row.nonRunner ?? row.non_runner ?? false),
        jockeyName: typeof row.jockeyName === "string" ? row.jockeyName : typeof row.jockey_name === "string" ? row.jockey_name : undefined,
        trainerName:
          typeof row.trainerName === "string" ? row.trainerName : typeof row.trainer_name === "string" ? row.trainer_name : undefined,
        draw: Number.isFinite(Number(row.draw)) ? Number(row.draw) : undefined,
      }
    })
    .filter((runner): runner is NonNullable<typeof runner> => Boolean(runner))
  const rawRunners = Array.isArray(raw.runners) ? raw.runners.map(String) : []
  const fallbackDetailed = rawRunners.map((runner) => ({
    horseUid: undefined,
    horseName: runner,
    nonRunner: false,
  }))
  const resolvedDetailed = runnersDetailed.length > 0 ? runnersDetailed : fallbackDetailed
  const runners =
    rawRunners.length > 0
      ? rawRunners
      : resolvedDetailed.filter((runner) => !runner.nonRunner).map((runner) => runner.horseName)
  const oddsSnapshot = oddsSnapshotRaw
    .map((entry) => {
      const row = entry as Record<string, unknown>
      const horseName = String(row.horseName ?? "")
      const bestFractional = String(row.bestFractional ?? "")
      const bestDecimal = Number(row.bestDecimal)
      if (!horseName || !bestFractional || !Number.isFinite(bestDecimal)) {
        return null
      }
      return {
        horseName,
        horseUid: Number.isFinite(Number(row.horseUid)) ? Number(row.horseUid) : undefined,
        bestFractional,
        bestDecimal,
        bestBookmaker: typeof row.bestBookmaker === "string" ? row.bestBookmaker : undefined,
        booksQuoted: Number.isFinite(Number(row.booksQuoted)) ? Number(row.booksQuoted) : 0,
        impliedProbabilityPct: Number.isFinite(Number(row.impliedProbabilityPct))
          ? Number(row.impliedProbabilityPct)
          : 0,
        rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : 0,
        isFavourite: Boolean(row.isFavourite),
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  const result: Race["result"] = {
    winner: typeof resultRaw.winner === "string" ? resultRaw.winner : undefined,
    placed: Array.isArray(resultRaw.placed) ? resultRaw.placed.map(String) : [],
    source: (resultRaw.source as Race["result"]["source"]) ?? "manual",
    sourceRef: typeof resultRaw.sourceRef === "string" ? resultRaw.sourceRef : undefined,
    updatedAt: typeof resultRaw.updatedAt === "string" ? resultRaw.updatedAt : undefined,
  }
  const offTime = String(raw.offTime ?? nowIso())
  const lifecycle = deriveRaceLifecycle(offTime, result, nowIso())

  return {
    id,
    season: String(raw.season ?? CURRENT_SEASON),
    day: (raw.day as RaceDay) ?? "Tuesday",
    offTime,
    course: "Cheltenham",
    name: sanitizeRaceName(String(raw.name ?? "Unnamed race")) || "Unnamed race",
    externalRaceId:
      typeof raw.externalRaceId === "number"
        ? raw.externalRaceId
        : Number.isFinite(Number(raw.externalRaceId))
          ? Number(raw.externalRaceId)
          : undefined,
    source:
      raw.source === "cloudfront" || raw.source === "sportinglife"
        ? raw.source
        : "manual",
    importMeta:
      typeof importMetaRaw.importedAt === "string" &&
      typeof importMetaRaw.sourceUrl === "string" &&
      typeof importMetaRaw.runId === "string"
        ? {
            etag: typeof importMetaRaw.etag === "string" ? importMetaRaw.etag : undefined,
            importedAt: String(importMetaRaw.importedAt),
            sourceUrl: String(importMetaRaw.sourceUrl),
            runId: String(importMetaRaw.runId),
          }
        : undefined,
    oddsMeta:
      (oddsMetaRaw.source === "irishracing" || oddsMetaRaw.source === "sportinglife") &&
      typeof oddsMetaRaw.importedAt === "string" &&
      typeof oddsMetaRaw.sourceUrl === "string" &&
      typeof oddsMetaRaw.runId === "string"
        ? {
            source: oddsMetaRaw.source,
            importedAt: String(oddsMetaRaw.importedAt),
            sourceUrl: String(oddsMetaRaw.sourceUrl),
            runId: String(oddsMetaRaw.runId),
            marketType: "antepost",
          }
        : undefined,
    importLock: {
      lockedByManualOverride: Boolean(importLockRaw.lockedByManualOverride),
      reason: typeof importLockRaw.reason === "string" ? importLockRaw.reason : undefined,
      lockedAt: typeof importLockRaw.lockedAt === "string" ? importLockRaw.lockedAt : undefined,
    },
    runnersDetailed: resolvedDetailed,
    oddsSnapshot,
    marketFavourite:
      typeof marketFavouriteRaw.horseName === "string" &&
      typeof marketFavouriteRaw.bestFractional === "string" &&
      Number.isFinite(Number(marketFavouriteRaw.bestDecimal))
        ? {
            horseName: String(marketFavouriteRaw.horseName),
            horseUid: Number.isFinite(Number(marketFavouriteRaw.horseUid))
              ? Number(marketFavouriteRaw.horseUid)
              : undefined,
            bestFractional: String(marketFavouriteRaw.bestFractional),
            bestDecimal: Number(marketFavouriteRaw.bestDecimal),
            source:
              marketFavouriteRaw.source === "sportinglife" || marketFavouriteRaw.source === "irishracing"
                ? marketFavouriteRaw.source
                : "sportinglife",
            importedAt:
              typeof marketFavouriteRaw.importedAt === "string"
                ? String(marketFavouriteRaw.importedAt)
                : nowIso(),
          }
        : undefined,
    runners,
    status: (raw.status as Race["status"]) ?? "scheduled",
    lifecycle,
    result,
  }
}

function mapBetDoc(raw: Record<string, unknown>, id: string): Bet {
  return {
    id,
    season: String(raw.season ?? CURRENT_SEASON),
    userId: String(raw.userId ?? ""),
    betType: (raw.betType as BetType) ?? "single",
    betName: typeof raw.betName === "string" ? raw.betName : undefined,
    oddsUsed: isValidOdds(Number(raw.oddsUsed)) ? Number(raw.oddsUsed) : undefined,
    legs: Array.isArray(raw.legs)
      ? raw.legs.map((leg) => {
          const row = leg as Record<string, unknown>
          return {
            raceId: String(row.raceId ?? ""),
            selectionName: String(row.selectionName ?? ""),
            decimalOdds: Number(row.decimalOdds ?? 0),
            horseUid: Number.isFinite(Number(row.horseUid)) ? Number(row.horseUid) : undefined,
            result: (row.result as LegResult) ?? "pending",
          }
        })
      : [],
    legRaceIds: Array.isArray(raw.legRaceIds) ? raw.legRaceIds.map(String) : [],
    stakeTotal: Number(raw.stakeTotal ?? 0),
    isFreeBet: Boolean(raw.isFreeBet ?? false),
    ewTerms:
      raw.ewTerms && typeof raw.ewTerms === "object"
        ? {
            placesPaid: Number((raw.ewTerms as EwTerms).placesPaid ?? 0),
            placeFraction: Number((raw.ewTerms as EwTerms).placeFraction ?? 0),
          }
        : undefined,
    lockAt: String(raw.lockAt ?? nowIso()),
    status: (raw.status as BetStatus) ?? "open",
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso()),
    settledAt: typeof raw.settledAt === "string" ? raw.settledAt : undefined,
    totalReturn: typeof raw.totalReturn === "number" ? raw.totalReturn : undefined,
    profitLoss: typeof raw.profitLoss === "number" ? raw.profitLoss : undefined,
  }
}

function mapUserDoc(raw: Record<string, unknown>, id: string): UserProfile {
  return {
    id,
    displayName: String(raw.displayName ?? id),
    isActive: Boolean(raw.isActive ?? true),
  }
}

function mapUserStatsDoc(raw: Record<string, unknown>, id: string): UserStats {
  return {
    userId: id,
    totalStaked: Number(raw.totalStaked ?? 0),
    totalReturns: Number(raw.totalReturns ?? 0),
    profitLoss: Number(raw.profitLoss ?? 0),
    roasPct: Number(raw.roasPct ?? 0),
    winPct: Number(raw.winPct ?? 0),
    betsPlaced: Number(raw.betsPlaced ?? 0),
    averageOdds: Number(raw.averageOdds ?? 0),
    biggestLoss: Number(raw.biggestLoss ?? 0),
    biggestWin: Number(raw.biggestWin ?? 0),
    averageStake: Number(raw.averageStake ?? 0),
  }
}

async function writeEvent(type: string, payload: Record<string, unknown>) {
  await eventsCol(db).add({
    type,
    payload,
    season: CURRENT_SEASON,
    createdAt: nowIso(),
  })
}

async function getRaces(): Promise<Race[]> {
  const snapshot = await racesCol(db).get()
  return snapshot.docs
    .map((entry) => mapRaceDoc(entry.data() as Record<string, unknown>, entry.id))
    .sort((a, b) => new Date(a.offTime).getTime() - new Date(b.offTime).getTime())
}

async function getUsers(): Promise<UserProfile[]> {
  const snapshot = await usersCol(db).get()
  return snapshot.docs
    .map((entry) => mapUserDoc(entry.data() as Record<string, unknown>, entry.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

async function getBets(): Promise<Bet[]> {
  const snapshot = await betsCol(db).get()
  return snapshot.docs
    .map((entry) => mapBetDoc(entry.data() as Record<string, unknown>, entry.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

async function getUserStats(): Promise<UserStats[]> {
  const snapshot = await userStatsCol(db).get()
  return snapshot.docs.map((entry) => mapUserStatsDoc(entry.data() as Record<string, unknown>, entry.id))
}

async function getGlobalStats(): Promise<GlobalStats | null> {
  const snapshot = await globalStatsDoc(db).get()
  if (!snapshot.exists) {
    return null
  }

  const raw = snapshot.data() as Record<string, unknown>
  return {
    totalStaked: Number(raw.totalStaked ?? 0),
    totalReturns: Number(raw.totalReturns ?? 0),
    averageStake: Number(raw.averageStake ?? 0),
    averageOdds: Number(raw.averageOdds ?? 0),
    roasPct: Number(raw.roasPct ?? 0),
    winPct: Number(raw.winPct ?? 0),
    betsPlaced: Number(raw.betsPlaced ?? 0),
    biggestLoss: Number(raw.biggestLoss ?? 0),
    biggestWin: Number(raw.biggestWin ?? 0),
    biggestWinUserId: typeof raw.biggestWinUserId === "string" ? raw.biggestWinUserId : undefined,
    updatedAt: String(raw.updatedAt ?? nowIso()),
  }
}

async function recomputeAndPersistStats(): Promise<void> {
  const users = await getUsers()
  const betsRaw = await getBets()
  const now = nowIso()
  const bets = betsRaw.map((bet) => ({
    ...bet,
    status: getDerivedBetStatus(bet, now),
  }))

  const batch = db.batch()
  users.forEach((user) => {
    const stats = computeUserStats(user, bets)
    batch.set(userStatsCol(db).doc(user.id), stats, { merge: true })
  })

  const globalStats = computeGlobalStats(bets, users, now)
  batch.set(globalStatsDoc(db), globalStats, { merge: true })
  await batch.commit()
}

function buildBetPayload(input: BetDraftInput, races: Race[], existingId?: string): Bet {
  const now = nowIso()
  const normalizedBetName = input.betName?.trim()
  const rawBetType = typeof input.betType === "string" ? input.betType.toLowerCase() : ""
  const normalizedBetType: BetType =
    rawBetType === "single" ||
    rawBetType === "each_way" ||
    rawBetType === "accumulator" ||
    rawBetType === "other"
      ? (rawBetType as BetType)
      : "single"
  const inputLegs = Array.isArray(input.legs) ? input.legs : []
  const isOtherBet = normalizedBetType === "other" || (!rawBetType && Boolean(normalizedBetName) && inputLegs.length === 0)
  if (!input.userId) {
    throw new Error("Pick a user")
  }
  if (input.stakeTotal <= 0) {
    throw new Error("Stake must be greater than zero")
  }

  if (isOtherBet) {
    if (!normalizedBetName) {
      throw new Error("Other bets need a name")
    }

    const requestedOddsUsed = Number(input.oddsUsed)
    const oddsUsed = isValidOdds(requestedOddsUsed) ? requestedOddsUsed : undefined
    const syntheticLeg: BetLeg = {
      raceId: "__other__",
      selectionName: normalizedBetName,
      decimalOdds: oddsUsed ?? 1,
      horseUid: undefined,
      result: "pending",
    }

    return {
      id: existingId ?? "",
      season: CURRENT_SEASON,
      userId: input.userId,
      betType: "other",
      betName: normalizedBetName,
      oddsUsed,
      legs: [syntheticLeg],
      legRaceIds: [syntheticLeg.raceId],
      stakeTotal: Number(input.stakeTotal),
      isFreeBet: Boolean(input.isFreeBet),
      ewTerms: undefined,
      lockAt: "2099-12-31T23:59:59.999Z",
      status: "open",
      createdAt: now,
      updatedAt: now,
    }
  }

  if (!inputLegs.length) {
    throw new Error("Add at least one bet leg")
  }
  if (normalizedBetType !== "accumulator" && inputLegs.length !== 1) {
    throw new Error("Single and each-way bets must have exactly one leg")
  }
  if (normalizedBetType === "each_way" && !input.ewTerms) {
    throw new Error("Each-way terms are required")
  }

  const legLifecycles: Array<Race["lifecycle"]> = []
  const formattedLegs = inputLegs.map((leg) => {
    const race = races.find((entry) => entry.id === leg.raceId)
    if (!race) {
      throw new Error("One or more legs reference missing races")
    }
    if (!validateRunnerSelection(leg.selectionName, race, leg.horseUid)) {
      throw new Error(`Selection '${leg.selectionName}' is not in the runner list for ${race.name}`)
    }
    const parsedLegOdds = Number(leg.decimalOdds)
    const hasLegOdds = isValidOdds(parsedLegOdds)
    if (normalizedBetType !== "accumulator" && !hasLegOdds) {
      throw new Error("Decimal odds are required for every leg and must be >= 1.0")
    }
    const decimalOdds = hasLegOdds ? parsedLegOdds : 1
    const matchedRunner = findRaceRunner(race, leg.selectionName, leg.horseUid)
    const lifecycle = deriveRaceLifecycle(race.offTime, race.result, now)
    legLifecycles.push(lifecycle)

    return {
      raceId: leg.raceId,
      selectionName: runnerToDisplayName(matchedRunner?.horseName ?? leg.selectionName),
      decimalOdds,
      horseUid: matchedRunner?.horseUid,
      result:
        lifecycle === "complete"
          ? deriveLegResult(matchedRunner?.horseName ?? leg.selectionName, race, matchedRunner?.horseUid)
          : ("pending" as const),
    }
  })

  const autoOddsUsed =
    normalizedBetType === "accumulator"
      ? roundTo(
          formattedLegs.reduce((acc, leg) => {
            const odds = isValidOdds(leg.decimalOdds) ? leg.decimalOdds : 1
            return acc * odds
          }, 1),
          4,
        )
      : formattedLegs[0]?.decimalOdds
  const requestedOddsUsed = Number(input.oddsUsed)
  const oddsUsed = isValidOdds(requestedOddsUsed)
    ? requestedOddsUsed
    : isValidOdds(autoOddsUsed)
      ? autoOddsUsed
      : null
  if (!isValidOdds(oddsUsed)) {
    throw new Error("Final decimal odds are required and must be >= 1.0")
  }

  const lockAt = deriveLockAt(formattedLegs, races)
  const allLegsComplete = legLifecycles.every((entry) => entry === "complete")
  if (new Date(now).getTime() > new Date(lockAt).getTime() && !allLegsComplete) {
    throw new Error("Race is already locked")
  }

  const baseBet: Bet = {
    id: existingId ?? "",
    season: CURRENT_SEASON,
    userId: input.userId,
    betType: normalizedBetType,
    betName: undefined,
    oddsUsed,
    legs: formattedLegs,
    legRaceIds: [...new Set(formattedLegs.map((leg) => leg.raceId))],
    stakeTotal: Number(input.stakeTotal),
    isFreeBet: Boolean(input.isFreeBet),
    ewTerms: normalizedBetType === "each_way" ? input.ewTerms : undefined,
    lockAt,
    status: "open",
    createdAt: now,
    updatedAt: now,
  }

  if (isBetSettleable(baseBet)) {
    const totalReturn = Number(calculateBetReturn(baseBet).toFixed(2))
    const profitLoss = Number((totalReturn - getBetRiskStake(baseBet)).toFixed(2))
    return {
      ...baseBet,
      status: "settled",
      settledAt: now,
      totalReturn,
      profitLoss,
    }
  }

  return {
    ...baseBet,
    status: getDerivedBetStatus(baseBet, now),
  }
}

async function bootstrapSeason(): Promise<void> {
  const now = nowIso()

  await seasonDoc(db).set(
    {
      season: CURRENT_SEASON,
      timezone: "Europe/London",
      resultGraceMinutes: 10,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  )

  const existingUsers = await usersCol(db).get()
  if (existingUsers.empty) {
    const batch = db.batch()
    DEFAULT_USERS.forEach((user) => {
      batch.set(usersCol(db).doc(user.id), user)
    })
    await batch.commit()
  }

  await jobsCol(db)
    .doc("phase1_defaults")
    .set(
      {
        id: "phase1_defaults",
        status: "ready",
        updatedAt: now,
      },
      { merge: true },
    )
}

async function createBet(input: BetDraftInput): Promise<void> {
  const races = await getRaces()
  const payload = buildBetPayload(input, races)
  const ref = betsCol(db).doc()

  await ref.set({
    ...payload,
    id: ref.id,
  })

  await recomputeAndPersistStats()
  await writeEvent("bet_created", { betId: ref.id, status: payload.status })
}

async function updateBet(betId: string, input: BetDraftInput): Promise<void> {
  const races = await getRaces()
  const currentSnapshot = await betsCol(db).doc(betId).get()
  if (!currentSnapshot.exists) {
    throw new Error("Bet not found")
  }

  const current = mapBetDoc(currentSnapshot.data() as Record<string, unknown>, currentSnapshot.id)
  const now = nowIso()
  if (getDerivedBetStatus(current, now) !== "open") {
    throw new Error("Only open bets can be edited")
  }

  const payload = buildBetPayload(input, races, betId)

  await betsCol(db)
    .doc(betId)
    .set(
      {
        ...payload,
        id: betId,
        createdAt: current.createdAt,
        updatedAt: now,
        status: payload.status,
        settledAt: payload.settledAt,
        totalReturn: payload.totalReturn,
        profitLoss: payload.profitLoss,
      },
      { merge: true },
    )

  await recomputeAndPersistStats()
  await writeEvent("bet_updated", { betId, status: payload.status })
}

async function removeBet(betId: string): Promise<void> {
  const snapshot = await betsCol(db).doc(betId).get()
  if (!snapshot.exists) {
    throw new Error("Bet not found")
  }

  const bet = mapBetDoc(snapshot.data() as Record<string, unknown>, snapshot.id)
  if (getDerivedBetStatus(bet, nowIso()) !== "open") {
    throw new Error("Only open bets can be deleted")
  }

  await betsCol(db).doc(betId).delete()
  await recomputeAndPersistStats()
  await writeEvent("bet_deleted", { betId })
}

async function resolveOtherBetManually(betId: string, input: ManualOtherSettleInput): Promise<void> {
  const snapshot = await betsCol(db).doc(betId).get()
  if (!snapshot.exists) {
    throw new Error("Bet not found")
  }

  const bet = mapBetDoc(snapshot.data() as Record<string, unknown>, snapshot.id)
  if (bet.betType !== "other") {
    throw new Error("Only 'other' bets can be manually resolved here")
  }
  if (bet.status === "settled") {
    throw new Error("Bet is already settled")
  }

  const parsedReturn = Number(input.totalReturn)
  if (!Number.isFinite(parsedReturn) || parsedReturn < 0) {
    throw new Error("Manual return must be a valid number >= 0")
  }

  const now = nowIso()
  const totalReturn = roundMoney(parsedReturn)
  const profitLoss = roundMoney(totalReturn - getBetRiskStake(bet))
  const legResult: LegResult =
    totalReturn === 0 ? "lose" : Math.abs(totalReturn - getBetRiskStake(bet)) < 0.005 ? "void" : "win"

  await betsCol(db)
    .doc(betId)
    .set(
      {
        status: "settled",
        settledAt: now,
        updatedAt: now,
        totalReturn,
        profitLoss,
        legs: bet.legs.map((leg) => ({ ...leg, result: legResult })),
      },
      { merge: true },
    )

  await recomputeAndPersistStats()
  await writeEvent("bet_manual_settled", { betId, totalReturn, profitLoss })
}

async function settleRace(
  raceId: string,
  options?: { resultSource?: Race["result"]["source"]; skipStatsRecompute?: boolean },
): Promise<boolean> {
  const raceReference = racesCol(db).doc(raceId)
  const raceSnapshot = await raceReference.get()
  if (!raceSnapshot.exists) {
    throw new Error("Race not found")
  }

  const race = mapRaceDoc(raceSnapshot.data() as Record<string, unknown>, raceSnapshot.id)
  if (!race.result.winner && race.result.placed.length === 0) {
    throw new Error("Add race result before settlement")
  }

  const relatedBets = await betsCol(db).where("legRaceIds", "array-contains", raceId).get()
  const batch = db.batch()
  const now = nowIso()
  let settledAnyBet = false

  relatedBets.docs.forEach((entry) => {
    const bet = mapBetDoc(entry.data() as Record<string, unknown>, entry.id)
    if (bet.status === "settled") {
      return
    }

    const updatedLegs = bet.legs.map((leg) => {
      if (leg.raceId !== raceId) {
        return leg
      }
      return {
        ...leg,
        result: deriveLegResult(leg.selectionName, race, leg.horseUid),
      }
    })

    const updatedBet: Bet = {
      ...bet,
      legs: updatedLegs,
      updatedAt: now,
      status: getDerivedBetStatus({ ...bet, legs: updatedLegs }, now),
    }

    if (isBetSettleable(updatedBet)) {
      const totalReturn = Number(calculateBetReturn(updatedBet).toFixed(2))
      const profitLoss = Number((totalReturn - getBetRiskStake(updatedBet)).toFixed(2))
      settledAnyBet = true
      batch.set(
        betsCol(db).doc(bet.id),
        {
          ...updatedBet,
          status: "settled",
          settledAt: now,
          totalReturn,
          profitLoss,
        },
        { merge: true },
      )
    } else {
      batch.set(betsCol(db).doc(bet.id), updatedBet, { merge: true })
    }
  })

  batch.set(
    raceReference,
    {
      status: "settled",
      lifecycle: "complete",
      result: {
        ...race.result,
        source: options?.resultSource ?? race.result.source ?? "manual",
        updatedAt: now,
      },
    },
    { merge: true },
  )

  await batch.commit()
  if (!options?.skipStatsRecompute) {
    await recomputeAndPersistStats()
  }

  if (race.status !== "settled") {
    const notificationClaim = await claimRaceResultNotificationDispatch(race, now)
    if (notificationClaim.shouldSend) {
      await dispatchRaceResultTelegramNotification(notificationClaim.notificationId, race, now)
    }
    await writeEvent("race_settled", { raceId })
  }

  return settledAnyBet || race.status !== "settled"
}

async function queueDailySummary(stats: GlobalStats): Promise<void> {
  const now = nowIso()
  const notificationRef = notificationsCol(db).doc()

  await notificationRef.set({
    id: notificationRef.id,
    eventType: "daily_summary",
    payload: stats,
    status: "pending",
    retries: 0,
    createdAt: now,
    updatedAt: now,
  })

  await writeEvent("daily_summary_queued", { notificationId: notificationRef.id })
}

function createEmptyImportSummary(): RaceImportSummary {
  return {
    racesInserted: 0,
    racesUpdated: 0,
    racesSkippedLocked: 0,
    runnersChanged: 0,
    nonRunnersDetected: 0,
    legsAutoVoided: 0,
    racesAutoSettled: 0,
    oddsRacesAttempted: 0,
    oddsRacesUpdated: 0,
    oddsRacesFailed: 0,
    oddsRowsParsed: 0,
  }
}

function mapImportRunDoc(raw: Record<string, unknown>, id: string): RaceImportRun {
  const summaryRaw = (raw.summary as Record<string, unknown> | undefined) ?? {}
  return {
    id,
    status: (raw.status as RaceImportRun["status"]) ?? "completed",
    startedAt: String(raw.startedAt ?? nowIso()),
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : undefined,
    sourceEtag: typeof raw.sourceEtag === "string" ? raw.sourceEtag : undefined,
    summary: {
      racesInserted: Number(summaryRaw.racesInserted ?? 0),
      racesUpdated: Number(summaryRaw.racesUpdated ?? 0),
      racesSkippedLocked: Number(summaryRaw.racesSkippedLocked ?? 0),
      runnersChanged: Number(summaryRaw.runnersChanged ?? 0),
      nonRunnersDetected: Number(summaryRaw.nonRunnersDetected ?? 0),
      legsAutoVoided: Number(summaryRaw.legsAutoVoided ?? 0),
      racesAutoSettled: Number(summaryRaw.racesAutoSettled ?? 0),
      oddsRacesAttempted: Number(summaryRaw.oddsRacesAttempted ?? 0),
      oddsRacesUpdated: Number(summaryRaw.oddsRacesUpdated ?? 0),
      oddsRacesFailed: Number(summaryRaw.oddsRacesFailed ?? 0),
      oddsRowsParsed: Number(summaryRaw.oddsRowsParsed ?? 0),
    },
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
  }
}

async function getLastRaceImportRun(): Promise<RaceImportRun | null> {
  const snapshot = await importJobsCol(db).orderBy("startedAt", "desc").limit(1).get()
  if (snapshot.empty) {
    return null
  }

  const entry = snapshot.docs[0]
  return mapImportRunDoc(entry.data() as Record<string, unknown>, entry.id)
}

async function acquireRaceImportLock(
  runId: string,
): Promise<{ acquired: boolean; sourceEtag?: string; sourcePayloadHash?: string }> {
  const lockRef = jobsCol(db).doc("race_import")
  const staleMs = IMPORT_LOCK_STALE_MINUTES * 60 * 1000
  const now = nowIso()

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef)
    const raw = (snapshot.data() as Record<string, unknown> | undefined) ?? {}

    const existingRunStatus = typeof raw.status === "string" ? raw.status : undefined
    const startedAtRaw = typeof raw.startedAt === "string" ? raw.startedAt : undefined
    const startedAtMs = startedAtRaw ? new Date(startedAtRaw).getTime() : NaN
    const stale =
      !Number.isFinite(startedAtMs) || Date.now() - startedAtMs > staleMs

    if (existingRunStatus === "running" && !stale) {
      return {
        acquired: false,
        sourceEtag: typeof raw.sourceEtag === "string" ? raw.sourceEtag : undefined,
        sourcePayloadHash: typeof raw.sourcePayloadHash === "string" ? raw.sourcePayloadHash : undefined,
      }
    }

    transaction.set(
      lockRef,
      {
        id: "race_import",
        status: "running",
        runId,
        startedAt: now,
        updatedAt: now,
        sourceEtag: typeof raw.sourceEtag === "string" ? raw.sourceEtag : undefined,
        sourcePayloadHash:
          typeof raw.sourcePayloadHash === "string" ? raw.sourcePayloadHash : undefined,
      },
      { merge: true },
    )

    return {
      acquired: true,
      sourceEtag: typeof raw.sourceEtag === "string" ? raw.sourceEtag : undefined,
      sourcePayloadHash: typeof raw.sourcePayloadHash === "string" ? raw.sourcePayloadHash : undefined,
    }
  })
}

async function releaseRaceImportLock(input: {
  runId: string
  status: "completed" | "noop" | "failed"
  sourceEtag?: string
  sourcePayloadHash?: string
}) {
  await jobsCol(db)
    .doc("race_import")
    .set(
      {
        id: "race_import",
        status: "idle",
        runId: input.runId,
        lastRunId: input.runId,
        lastRunStatus: input.status,
        sourceEtag: input.sourceEtag,
        sourcePayloadHash: input.sourcePayloadHash,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      },
      { merge: true },
    )
}

async function loadSportingLifeRaceUrls(): Promise<string[]> {
  const raw = await readFile(SPORTING_LIFE_RACE_URLS_FILE, "utf8")
  const seen = new Set<string>()

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) {
        return false
      }
      seen.add(url)
      return true
    })
}

async function fetchSportingLifePage(url: string): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SPORTING_LIFE_IMPORT_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": SPORTING_LIFE_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    })
    if (!response.ok) {
      throw new Error(`Sporting Life request failed (${response.status})`)
    }
    return await response.text()
  } finally {
    clearTimeout(timeoutId)
  }
}

function hasRunnerDiff(
  previous: NonNullable<Race["runnersDetailed"]> | undefined,
  next: NonNullable<Race["runnersDetailed"]>,
): boolean {
  const serialize = (rows: NonNullable<Race["runnersDetailed"]> | undefined) =>
    JSON.stringify(
      (rows ?? []).map((runner) => ({
        horseUid: runner.horseUid ?? null,
        horseName: runner.horseName,
        nonRunner: runner.nonRunner,
      })),
    )

  return serialize(previous) !== serialize(next)
}

async function autoVoidNonRunnerLegs(
  raceId: string,
  nonRunners: NonNullable<Race["runnersDetailed"]>,
): Promise<number> {
  if (!nonRunners.length) {
    return 0
  }

  const nonRunnerByUid = new Set(
    nonRunners
      .map((runner) => runner.horseUid)
      .filter((horseUid): horseUid is number => typeof horseUid === "number"),
  )
  const nonRunnerByName = new Set(nonRunners.map((runner) => normalizeHorseName(runner.horseName)))

  const snapshot = await betsCol(db).where("legRaceIds", "array-contains", raceId).get()
  const batch = db.batch()
  const now = nowIso()
  let updatedBets = 0
  let voidedLegs = 0

  snapshot.docs.forEach((entry) => {
    const bet = mapBetDoc(entry.data() as Record<string, unknown>, entry.id)
    if (bet.status === "settled" || bet.status === "void") {
      return
    }

    let changed = false
    const nextLegs = bet.legs.map((leg) => {
      if (leg.raceId !== raceId || leg.result === "void") {
        return leg
      }

      const matchedByUid = typeof leg.horseUid === "number" && nonRunnerByUid.has(leg.horseUid)
      const matchedByName = nonRunnerByName.has(normalizeHorseName(leg.selectionName))
      if (!matchedByUid && !matchedByName) {
        return leg
      }

      changed = true
      voidedLegs += 1
      return {
        ...leg,
        result: "void" as const,
      }
    })

    if (!changed) {
      return
    }

    updatedBets += 1
    const updatedBet: Bet = {
      ...bet,
      legs: nextLegs,
      status: getDerivedBetStatus({ ...bet, legs: nextLegs }, now),
      updatedAt: now,
    }

    if (isBetSettleable(updatedBet)) {
      const totalReturn = Number(calculateBetReturn(updatedBet).toFixed(2))
      const profitLoss = Number((totalReturn - getBetRiskStake(updatedBet)).toFixed(2))
      batch.set(
        betsCol(db).doc(bet.id),
        {
          ...updatedBet,
          status: "settled",
          settledAt: now,
          totalReturn,
          profitLoss,
        },
        { merge: true },
      )
      return
    }

    batch.set(betsCol(db).doc(bet.id), updatedBet, { merge: true })
  })

  if (updatedBets > 0) {
    await batch.commit()
    await writeEvent("non_runner_auto_void", {
      raceId,
      updatedBets,
      voidedLegs,
    })
  }

  return voidedLegs
}

async function runRaceImport(runId: string): Promise<RaceImportRun> {
  const startedAt = nowIso()
  const summary = createEmptyImportSummary()
  const warnings: string[] = []
  const errors: string[] = []

  const lockState = await acquireRaceImportLock(runId)
  if (!lockState.acquired) {
    const busyRun: RaceImportRun = {
      id: runId,
      status: "busy",
      startedAt,
      completedAt: nowIso(),
      sourceEtag: lockState.sourceEtag,
      summary,
      warnings,
      errors: ["Race import is already running"],
    }
    await importJobsCol(db).doc(runId).set(busyRun, { merge: true })
    return busyRun
  }

  await importJobsCol(db).doc(runId).set(
    {
      id: runId,
      status: "running",
      startedAt,
      warnings: [],
      errors: [],
      summary,
    },
    { merge: true },
  )

  const sourceEtag = lockState.sourceEtag
  let sourcePayloadHash = lockState.sourcePayloadHash

  try {
    const raceUrls = await loadSportingLifeRaceUrls()
    if (raceUrls.length === 0) {
      throw new Error("Sporting Life race URL list is empty")
    }

    const sourceParts: string[] = []
    const parsedPages: Array<{
      sourceUrl: string
      externalRaceId: number
      name: string
      offTime: string
      raceStage: string
      runnersDetailed: NonNullable<Race["runnersDetailed"]>
      runners: string[]
      oddsSnapshot: NonNullable<Race["oddsSnapshot"]>
      marketFavourite?: Pick<NonNullable<Race["marketFavourite"]>, "horseName" | "horseUid" | "bestFractional" | "bestDecimal">
      result: Pick<Race["result"], "winner" | "placed"> | null
    }> = []

    for (const raceUrl of raceUrls) {
      try {
        parseSportingLifeRaceUrl(raceUrl)
        const html = await fetchSportingLifePage(raceUrl)
        sourceParts.push(`${raceUrl}\n${html}`)
        const parsed = parseSportingLifeRacePageHtml(html)
        parsedPages.push({
          sourceUrl: raceUrl,
          ...parsed,
        })
      } catch (pageError) {
        const message = pageError instanceof Error ? pageError.message : "Unknown Sporting Life import error"
        warnings.push(`sportinglife_page_failed:${raceUrl}:${message}`)
      }
    }

    sourcePayloadHash = toStringHash(sourceParts.join("\n\n"))
    const sportingLifeChanged = sourcePayloadHash !== lockState.sourcePayloadHash

    const existingSnapshot = await racesCol(db).get()
    const existingRaces = existingSnapshot.docs.map((doc) =>
      mapRaceDoc(doc.data() as Record<string, unknown>, doc.id),
    )
    const existingByExternalRaceId = new Map<number, Race>()
    existingRaces.forEach((race) => {
      if (typeof race.externalRaceId === "number") {
        existingByExternalRaceId.set(race.externalRaceId, race)
      }
    })

    const racesNeedingSettlement: string[] = []

    for (const sourceRace of parsedPages) {
        const externalRaceId = sourceRace.externalRaceId
        const raceTitle = sanitizeRaceName(sourceRace.name)
        const offTime = sourceRace.offTime
        const existingRace = existingByExternalRaceId.get(externalRaceId)
        const raceRef = existingRace
          ? racesCol(db).doc(existingRace.id)
          : racesCol(db).doc(String(externalRaceId))

        if (existingRace?.importLock?.lockedByManualOverride) {
          summary.racesSkippedLocked += 1
          continue
        }

        const runnersDetailed = sourceRace.runnersDetailed
        const runners = sourceRace.runners
        const oddsSnapshot = sourceRace.oddsSnapshot
        const marketFavourite = sourceRace.marketFavourite
        const parsedResult = sourceRace.result

        if (hasRunnerDiff(existingRace?.runnersDetailed, runnersDetailed)) {
          summary.runnersChanged += 1
        }

        const nonRunners = runnersDetailed.filter((runner) => runner.nonRunner)
        summary.nonRunnersDetected += nonRunners.length

        const raceStatus: Race["status"] =
          existingRace?.status === "settled" && !parsedResult
            ? "settled"
            : parsedResult
              ? "result_pending"
              : sourceRace.raceStage === "DORMANT"
                ? "scheduled"
                : new Date(offTime).getTime() <= Date.now()
                  ? "off"
                  : "scheduled"
        const raceResult: Race["result"] = parsedResult
          ? {
              winner: parsedResult.winner,
              placed: parsedResult.placed,
              source: "scrape",
              sourceRef: sourceRace.sourceUrl,
              updatedAt: nowIso(),
            }
          : existingRace?.result ?? EMPTY_RACE_RESULT
        const lifecycle = deriveRaceLifecycle(offTime, raceResult, nowIso())

        await raceRef.set(
          {
            id: raceRef.id,
            season: CURRENT_SEASON,
            day: toRaceDay(offTime),
            offTime,
            course: "Cheltenham",
            name: raceTitle,
            externalRaceId,
            source: "sportinglife",
            importMeta: {
              etag: sourceEtag,
              importedAt: nowIso(),
              sourceUrl: sourceRace.sourceUrl,
              runId,
            },
            oddsMeta:
              oddsSnapshot.length > 0
                ? {
                    source: "sportinglife",
                    importedAt: nowIso(),
                    sourceUrl: sourceRace.sourceUrl,
                    runId,
                    marketType: "antepost",
                  }
                : undefined,
            importLock: existingRace?.importLock ?? {
              lockedByManualOverride: false,
            },
            runnersDetailed,
            oddsSnapshot,
            marketFavourite:
              marketFavourite === undefined
                ? undefined
                : {
                    ...marketFavourite,
                    source: "sportinglife",
                    importedAt: nowIso(),
                  },
            runners,
            status: raceStatus,
            lifecycle,
            result: raceResult,
          },
          { merge: true },
        )

        if (existingRace) {
          summary.racesUpdated += 1
        } else {
          summary.racesInserted += 1
        }

        const autoVoided = await autoVoidNonRunnerLegs(raceRef.id, nonRunners)
        summary.legsAutoVoided += autoVoided

        if (parsedResult) {
          racesNeedingSettlement.push(raceRef.id)
        }

        summary.oddsRacesAttempted += 1
        summary.oddsRowsParsed += oddsSnapshot.length
        if (oddsSnapshot.length > 0) {
          summary.oddsRacesUpdated += 1
        } else {
          summary.oddsRacesFailed += 1
          warnings.push(`sportinglife_odds_unavailable:${raceRef.id}:${sourceRace.sourceUrl}`)
        }
    }

    for (const raceId of racesNeedingSettlement) {
      const settled = await settleRace(raceId, {
        resultSource: "scrape",
        skipStatsRecompute: true,
      })
      if (settled) {
        summary.racesAutoSettled += 1
      }
    }

    await recomputeAndPersistStats()

    const completedAt = nowIso()
    const runStatus: RaceImportRun["status"] =
      !sportingLifeChanged && summary.oddsRacesUpdated === 0 && summary.oddsRacesFailed === 0
        ? "noop"
        : "completed"
    const completedRun: RaceImportRun = {
      id: runId,
      status: runStatus,
      startedAt,
      completedAt,
      sourceEtag,
      summary,
      warnings,
      errors,
    }

    await importJobsCol(db).doc(runId).set(completedRun, { merge: true })
    await writeEvent("race_import_completed", {
      runId,
      summary,
      warningsCount: warnings.length,
    })
    await releaseRaceImportLock({
      runId,
      status: runStatus === "noop" ? "noop" : "completed",
      sourceEtag,
      sourcePayloadHash,
    })
    return completedRun
  } catch (error) {
    const completedAt = nowIso()
    const message = error instanceof Error ? error.message : "Import failed"
    errors.push(message)

    const failedRun: RaceImportRun = {
      id: runId,
      status: "failed",
      startedAt,
      completedAt,
      sourceEtag,
      summary,
      warnings,
      errors,
    }
    await importJobsCol(db).doc(runId).set(failedRun, { merge: true })
    await releaseRaceImportLock({
      runId,
      status: "failed",
      sourceEtag,
      sourcePayloadHash,
    })
    return failedRun
  }
}

async function loadState(): Promise<TrackerState> {
  const users = await getUsers()
  const [races, bets] = await Promise.all([getRaces(), getBets()])
  const atIso = nowIso()

  const [userStats, globalStats] = await Promise.all([getUserStats(), getGlobalStats()])

  return {
    users,
    races,
    bets,
    userStats,
    globalStats,
    version: atIso,
  }
}

function withCorsHeaders(headers = new Headers()): Headers {
  headers.set("Access-Control-Allow-Origin", APP_ORIGIN)
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
  headers.set("Access-Control-Allow-Headers", "Content-Type")
  return headers
}

function jsonResponse(payload: unknown, status = 200): Response {
  const headers = withCorsHeaders(new Headers())
  headers.set("Content-Type", "application/json")
  return new Response(JSON.stringify(payload), { status, headers })
}

function errorResponse(error: unknown, status = 400): Response {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error && typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message: string }).message)
          : "Unknown error"
  return jsonResponse({ error: message }, status)
}

async function parseJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T
}

let currentState: TrackerState | null = null
let currentDigest = ""
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>()
const encoder = new TextEncoder()
let stateRefreshTickerStarted = false
let bootstrapped = false
let bootstrapPromise: Promise<void> | null = null
const SSE_HEARTBEAT_MS = 5000

function digestState(state: TrackerState): string {
  const stableState = {
    users: state.users,
    races: state.races,
    bets: state.bets,
    userStats: state.userStats,
    globalStats: state.globalStats,
  }
  return JSON.stringify(stableState)
}

function broadcastState(state: TrackerState) {
  const data = encoder.encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
  sseClients.forEach((controller) => {
    try {
      controller.enqueue(data)
    } catch {
      sseClients.delete(controller)
    }
  })
}

async function refreshAndBroadcastIfChanged() {
  const nextState = await loadState()
  const nextDigest = digestState(nextState)
  if (nextDigest !== currentDigest) {
    currentState = nextState
    currentDigest = nextDigest
    broadcastState(nextState)
  }
}

function ensureStateRefreshTicker() {
  if (stateRefreshTickerStarted) {
    return
  }
  stateRefreshTickerStarted = true
  setInterval(() => {
    refreshAndBroadcastIfChanged().catch((error) => {
      console.error("state refresh failed", error)
    })
  }, 3000)
}

async function ensureBootstrapped() {
  if (bootstrapped) {
    return
  }
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await bootstrapSeason()
      currentState = await loadState()
      currentDigest = digestState(currentState)
      ensureStateRefreshTicker()
      bootstrapped = true
    })()
  }
  await bootstrapPromise
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, "") || "/"
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const startedAt = Date.now()
  console.info(`[api] ${requestId} ${request.method} ${pathname} start`)

  if (request.method === "OPTIONS") {
    const response = new Response(null, { headers: withCorsHeaders(new Headers()) })
    response.headers.set("x-request-id", requestId)
    console.info(`[api] ${requestId} ${request.method} ${pathname} -> ${response.status} (${Date.now() - startedAt}ms)`)
    return response
  }

  try {
    if (request.method === "GET" && pathname === "/api/health") {
      const diagnostics = {
        runtime: typeof Bun !== "undefined" ? "bun" : "node",
        nodeVersion: typeof process !== "undefined" ? process.version : undefined,
        vercel: Boolean(process.env.VERCEL),
        requestId,
        appOrigin: APP_ORIGIN,
        season: CURRENT_SEASON,
        bootstrapped,
        sseClients: sseClients.size,
        firebase: {
          projectId:
            process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID ?? "rocketmill-octane",
          hasServiceAccountJson: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
          hasGoogleApplicationCredentials: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
          initError: dbInitError?.message ?? null,
        },
      }
      console.info(`[api] ${requestId} health diagnostics`, diagnostics)
      const response = jsonResponse({ status: "ok", season: CURRENT_SEASON, diagnostics })
      response.headers.set("x-request-id", requestId)
      console.info(`[api] ${requestId} ${request.method} ${pathname} -> ${response.status} (${Date.now() - startedAt}ms)`)
      return response
    }

    if (dbInitError) {
      throw new Error(`Firestore init failed: ${dbInitError.message}`)
    }

    await ensureBootstrapped()

    if (request.method === "GET" && pathname === "/api/state") {
      return jsonResponse(currentState ?? (await loadState()))
    }

    if (request.method === "GET" && pathname === "/api/stream") {
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
      let heartbeatId: ReturnType<typeof setInterval> | null = null
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          sseClients.add(controller)
          controller.enqueue(encoder.encode(`event: connected\ndata: {"ok":true}\n\n`))
          if (currentState) {
            controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(currentState)}\n\n`))
          }
          heartbeatId = setInterval(() => {
            if (!streamController) {
              return
            }
            try {
              streamController.enqueue(encoder.encode(`: ping\n\n`))
            } catch {
              sseClients.delete(streamController)
              streamController = null
              if (heartbeatId) {
                clearInterval(heartbeatId)
                heartbeatId = null
              }
            }
          }, SSE_HEARTBEAT_MS)
        },
        cancel() {
          if (heartbeatId) {
            clearInterval(heartbeatId)
            heartbeatId = null
          }
          if (streamController) {
            sseClients.delete(streamController)
            streamController = null
          }
        },
      })

      return new Response(stream, {
        headers: withCorsHeaders(
          new Headers({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          }),
        ),
      })
    }

    if (request.method === "POST" && pathname === "/api/bootstrap") {
      await bootstrapSeason()
      if (!currentState) {
        currentState = await loadState()
        currentDigest = digestState(currentState)
      }
      return jsonResponse({ ok: true })
    }

    if (request.method === "POST" && pathname === "/api/stats/recompute") {
      await recomputeAndPersistStats()
      await refreshAndBroadcastIfChanged()
      return jsonResponse({ ok: true })
    }

    if (request.method === "GET" && pathname === "/api/import/races/last-run") {
      const run = await getLastRaceImportRun()
      return jsonResponse({ run })
    }

    if (request.method === "POST" && pathname === "/api/import/races/refresh") {
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const run = await runRaceImport(runId)
      if (run.status === "busy") {
        return jsonResponse({ ok: false, run, error: "Race import already in progress" }, 409)
      }
      await refreshAndBroadcastIfChanged()
      return jsonResponse({ ok: true, run })
    }

    if (request.method === "POST" && pathname === "/api/bets") {
      const input = await parseJson<BetDraftInput>(request)
      await createBet(input)
      await refreshAndBroadcastIfChanged()
      return jsonResponse({ ok: true })
    }

    if (request.method === "PUT" && pathname.startsWith("/api/bets/")) {
      const betId = pathname.split("/").at(-1)
      if (!betId) {
        return errorResponse("Missing bet id", 400)
      }
      const input = await parseJson<BetDraftInput>(request)
      await updateBet(betId, input)
      await refreshAndBroadcastIfChanged()
      return jsonResponse({ ok: true })
    }

    if (request.method === "DELETE" && pathname.startsWith("/api/bets/")) {
      const betId = pathname.split("/").at(-1)
      if (!betId) {
        return errorResponse("Missing bet id", 400)
      }
      await removeBet(betId)
      await refreshAndBroadcastIfChanged()
      return jsonResponse({ ok: true })
    }

    if (request.method === "POST" && pathname.startsWith("/api/bets/") && pathname.endsWith("/manual-settle")) {
      const betId = pathname.split("/")[3]
      if (!betId) {
        return errorResponse("Missing bet id", 400)
      }
      const input = await parseJson<ManualOtherSettleInput>(request)
      await resolveOtherBetManually(betId, input)
      await refreshAndBroadcastIfChanged()
      return jsonResponse({ ok: true })
    }

    if (request.method === "POST" && pathname === "/api/notifications/daily-summary") {
      const input = await parseJson<GlobalStats>(request)
      await queueDailySummary(input)
      await refreshAndBroadcastIfChanged()
      return jsonResponse({ ok: true })
    }

    if (request.method === "POST" && pathname === "/api/notifications/test-race-message") {
      const input = (await request.json().catch(() => ({}))) as TestRaceMessageInput
      const result = await sendTestRaceResultTelegram(input)
      return jsonResponse({ ok: result.status === "sent", result }, result.status === "sent" ? 200 : 502)
    }

    if (request.method === "POST" && pathname === "/api/telegram/webhook") {
      return await handleTelegramWebhook(request)
    }

      const notFound = errorResponse("Not found", 404)
      notFound.headers.set("x-request-id", requestId)
      console.warn(`[api] ${requestId} ${request.method} ${pathname} -> 404 (${Date.now() - startedAt}ms)`)
      return notFound
    } catch (error) {
      console.error(`[api] ${requestId} ${request.method} ${pathname} error`, error)
      const failed = errorResponse(error)
      failed.headers.set("x-request-id", requestId)
      console.info(`[api] ${requestId} ${request.method} ${pathname} -> ${failed.status} (${Date.now() - startedAt}ms)`)
      return failed
    }
}

if (typeof Bun !== "undefined" && !process.env.VERCEL) {
  ensureBootstrapped()
    .then(() => {
      Bun.serve({
        port: PORT,
        idleTimeout: 255,
        fetch: handleApiRequest,
      })
      console.log(`Cheltenham API server listening on http://localhost:${PORT}`)
    })
    .catch((error) => {
      console.error("Failed to start Cheltenham API server", error)
    })
}
