/**
 * Gemeinsames Footprint-Event-Format.
 *
 * Diese Datei ist der Vertrag zwischen allen Schreibern (Server-Plugin, später Capsule-Wrapper)
 * und allen Lesern (TUI, CLI-Report). Jede Änderung hier ist eine Format-Änderung:
 * bei inkompatiblen Änderungen SCHEMA_VERSION erhöhen.
 *
 * Bewusst ohne Laufzeit-Abhängigkeiten (kein zod o. ä.), damit CLI und Wrapper schlank bleiben.
 */

export const SCHEMA_VERSION = 1 as const

/**
 * Vom Capsule-Wrapper beim Starten von OpenCode gesetzt; das Plugin liest sie aus,
 * damit beide Quellen demselben Lauf zugeordnet werden können.
 */
export const RUN_ID_ENV = "OPENCODE_FOOTPRINT_RUN_ID"

/**
 * Wie zuverlässig ist ein Eintrag?
 * - hook:     direkt aus einem OpenCode-Hook/Event gemeldet
 * - inferred: abgeleitet/heuristisch (z. B. Netzwerkzugriff aus einem Bash-Befehl geparst)
 * - observed: unabhängig von OpenCode beobachtet (Capsule: Prozessbaum, FS-Watcher, Proxy)
 */
export const CONFIDENCES = ["hook", "inferred", "observed"] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** Wer hat den Eintrag geschrieben? */
export const SOURCES = ["plugin", "capsule"] as const
export type Source = (typeof SOURCES)[number]

interface BaseEvent {
  /** Schema-Version */
  v: typeof SCHEMA_VERSION
  /** ISO-8601-Zeitstempel */
  ts: string
  /** OpenCode-Session-ID */
  sessionID: string
  /** Optional: Capsule-Lauf, zu dem der Eintrag gehört */
  runID?: string
  source: Source
  confidence: Confidence
}

export interface SessionEvent extends BaseEvent {
  kind: "session"
  action: "started" | "idle" | "ended"
  /** Arbeitsverzeichnis der Session */
  directory?: string
}

export interface FileEvent extends BaseEvent {
  kind: "file"
  action: "created" | "edited" | "deleted" | "read"
  /** Pfad relativ zum Projekt, wenn möglich */
  path: string
  /** Stretch-Goal „Spar-Tipps“: Wurde nur ein Zeilenbereich gelesen? */
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
  /** Host oder URL */
  target: string
  /** Wie wurde der Zugriff erkannt? */
  via: "bash-heuristic" | "proxy"
  /** Auslösender Befehl bei heuristischer Erkennung */
  command?: string
}

export type FootprintEvent = SessionEvent | FileEvent | CommandEvent | NetworkEvent
export type FootprintKind = FootprintEvent["kind"]

/** Payload ohne die von `createEvent` gesetzten Metadaten. */
export type EventInput = FootprintEvent extends infer E
  ? E extends FootprintEvent
    ? Omit<E, "v" | "ts">
    : never
  : never

export function createEvent(input: EventInput, now: Date = new Date()): FootprintEvent {
  return { v: SCHEMA_VERSION, ts: now.toISOString(), ...input } as FootprintEvent
}

/** Eine JSONL-Zeile (inkl. abschließendem Zeilenumbruch). */
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
 * Liest eine JSONL-Zeile. Kaputte oder unbekannte Zeilen werden ignoriert (undefined),
 * damit ein abgebrochener Schreibvorgang nicht den ganzen Report unbrauchbar macht.
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
