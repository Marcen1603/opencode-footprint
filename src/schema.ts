/**
 * Shared footprint event format.
 *
 * This file is the contract between all writers (server plugin, later the capsule wrapper)
 * and all readers (TUI, CLI report). Every change here is a format change:
 * bump SCHEMA_VERSION on incompatible changes.
 *
 * Deliberately free of runtime dependencies (no zod or similar) to keep the CLI and wrapper lean.
 */

export const SCHEMA_VERSION = 1 as const

/**
 * Set by the capsule wrapper when it starts OpenCode; the plugin reads it
 * so that both sources can be attributed to the same run.
 */
export const RUN_ID_ENV = "OPENCODE_FOOTPRINT_RUN_ID"

/**
 * How reliable is an entry?
 * - hook:     reported directly by an OpenCode hook/event
 * - inferred: derived/heuristic (e.g. network access parsed from a bash command)
 * - observed: observed independently of OpenCode (capsule: process tree, FS watcher, proxy)
 */
export const CONFIDENCES = ["hook", "inferred", "observed"] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** Who wrote the entry? */
export const SOURCES = ["plugin", "capsule"] as const
export type Source = (typeof SOURCES)[number]

interface BaseEvent {
  /** Schema version */
  v: typeof SCHEMA_VERSION
  /** ISO 8601 timestamp */
  ts: string
  /** OpenCode session ID */
  sessionID: string
  /** Optional: capsule run the entry belongs to */
  runID?: string
  source: Source
  confidence: Confidence
}

export interface SessionEvent extends BaseEvent {
  kind: "session"
  action: "started" | "idle" | "ended"
  /** Working directory of the session */
  directory?: string
}

export interface FileEvent extends BaseEvent {
  kind: "file"
  action: "created" | "edited" | "deleted" | "read"
  /** Path relative to the project, if possible */
  path: string
  /** Stretch goal "saving tips": was only a line range read? */
  range?: { offset?: number; limit?: number }
}

export interface CommandEvent extends BaseEvent {
  kind: "command"
  command: string
  cwd?: string
  exitCode?: number
}

export interface NetworkEvent extends BaseEvent {
  kind: "network"
  /** Host or URL */
  target: string
  /** How was the access detected? */
  via: "bash-heuristic" | "proxy"
  /** Triggering command for heuristic detection */
  command?: string
}

export type FootprintEvent = SessionEvent | FileEvent | CommandEvent | NetworkEvent
export type FootprintKind = FootprintEvent["kind"]

/** Payload without the metadata set by `createEvent`. */
export type EventInput = FootprintEvent extends infer E
  ? E extends FootprintEvent
    ? Omit<E, "v" | "ts">
    : never
  : never

export function createEvent(input: EventInput, now: Date = new Date()): FootprintEvent {
  return { v: SCHEMA_VERSION, ts: now.toISOString(), ...input } as FootprintEvent
}

/** One JSONL line (including the trailing newline). */
export function serialize(event: FootprintEvent): string {
  return `${JSON.stringify(event)}\n`
}

const KINDS: ReadonlySet<string> = new Set<FootprintKind>(["session", "file", "command", "network"])

export function isFootprintEvent(value: unknown): value is FootprintEvent {
  if (typeof value !== "object" || value === null) return false
  const e = value as Record<string, unknown>
  return (
    e.v === SCHEMA_VERSION &&
    typeof e.ts === "string" &&
    typeof e.sessionID === "string" &&
    typeof e.kind === "string" &&
    KINDS.has(e.kind) &&
    (CONFIDENCES as readonly unknown[]).includes(e.confidence) &&
    (SOURCES as readonly unknown[]).includes(e.source)
  )
}

/**
 * Parses one JSONL line. Broken or unknown lines are ignored (undefined)
 * so that an interrupted write cannot make the whole report unusable.
 */
export function parseLine(line: string): FootprintEvent | undefined {
  const trimmed = line.trim()
  if (trimmed === "") return undefined
  try {
    const value: unknown = JSON.parse(trimmed)
    return isFootprintEvent(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function parseJsonl(content: string): FootprintEvent[] {
  return content.split("\n").flatMap((line) => parseLine(line) ?? [])
}
