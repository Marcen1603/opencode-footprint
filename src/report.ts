/**
 * Aggregates footprint events into a readable report (used by the CLI and the TUI).
 *
 * `buildReport` is pure data (testable, reusable by the TUI); `renderReport` turns it into plain
 * text without colors or terminal control codes so it also works in pipes and CI logs.
 */
import type {
  Confidence,
  FileEvent,
  FootprintEvent,
  FootprintKind,
  NetworkEvent,
  ToolEvent,
} from "./schema.js"

export function summarize(events: readonly FootprintEvent[]): Record<FootprintKind, number> {
  const counts: Record<FootprintKind, number> = {
    session: 0,
    file: 0,
    command: 0,
    network: 0,
    tool: 0,
  }
  for (const e of events) counts[e.kind]++
  return counts
}

type FileAction = FileEvent["action"]

export interface FileEntry {
  path: string
  /** How often each action happened on this path. */
  actions: Partial<Record<FileAction, number>>
  /** Number of reads that covered only a line range instead of the whole file. */
  rangedReads: number
  /** True if the file was created, edited or deleted (not just read). */
  changed: boolean
}

export interface CommandEntry {
  command: string
  cwd?: string | undefined
  exitCode?: number | undefined
  ts: string
}

export interface NetworkEntry {
  target: string
  count: number
  via: NetworkEvent["via"]
  confidence: Confidence
  /** Distinct commands that triggered the access (heuristic detection only). */
  commands: string[]
}

export interface ToolEntry {
  name: string
  category: ToolEvent["category"]
  count: number
}

export interface Report {
  sessionID: string
  directory?: string | undefined
  startedAt?: string | undefined
  lastActivityAt?: string | undefined
  /** Seconds between the first and the last event. */
  durationSeconds?: number | undefined
  counts: Record<FootprintKind, number>
  files: FileEntry[]
  commands: CommandEntry[]
  network: NetworkEntry[]
  tools: ToolEntry[]
}

export function buildReport(sessionID: string, events: readonly FootprintEvent[]): Report {
  const files = new Map<string, FileEntry>()
  const network = new Map<string, NetworkEntry>()
  const tools = new Map<string, ToolEntry>()
  const commands: CommandEntry[] = []
  let directory: string | undefined
  let first: string | undefined
  let last: string | undefined

  for (const e of events) {
    if (first === undefined || e.ts < first) first = e.ts
    if (last === undefined || e.ts > last) last = e.ts

    switch (e.kind) {
      case "session":
        if (e.directory !== undefined) directory ??= e.directory
        break
      case "file": {
        const entry = files.get(e.path) ?? {
          path: e.path,
          actions: {},
          rangedReads: 0,
          changed: false,
        }
        entry.actions[e.action] = (entry.actions[e.action] ?? 0) + 1
        if (e.action === "read" && e.range !== undefined) entry.rangedReads++
        if (e.action !== "read") entry.changed = true
        files.set(e.path, entry)
        break
      }
      case "command":
        commands.push({ command: e.command, cwd: e.cwd, exitCode: e.exitCode, ts: e.ts })
        break
      case "network": {
        const entry = network.get(e.target) ?? {
          target: e.target,
          count: 0,
          via: e.via,
          confidence: e.confidence,
          commands: [],
        }
        entry.count++
        if (e.command !== undefined && !entry.commands.includes(e.command)) {
          entry.commands.push(e.command)
        }
        network.set(e.target, entry)
        break
      }
      case "tool": {
        const key = `${e.category}:${e.name}`
        const entry = tools.get(key) ?? { name: e.name, category: e.category, count: 0 }
        entry.count++
        tools.set(key, entry)
        break
      }
    }
  }

  const seconds =
    first !== undefined && last !== undefined
      ? Math.max(0, Math.round((Date.parse(last) - Date.parse(first)) / 1000))
      : undefined

  return {
    sessionID,
    directory,
    startedAt: first,
    lastActivityAt: last,
    durationSeconds: Number.isFinite(seconds) ? seconds : undefined,
    counts: summarize(events),
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    commands,
    network: [...network.values()].sort(
      (a, b) => b.count - a.count || a.target.localeCompare(b.target),
    ),
    tools: [...tools.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}

export interface RenderOptions {
  /** Max entries per section before the rest is collapsed into "… N more". Default 15. */
  limit?: number
  /** Show everything, ignoring `limit`. */
  all?: boolean
}

const DEFAULT_LIMIT = 15
const COMMAND_WIDTH = 100

function oneLine(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim()
  return flat.length > COMMAND_WIDTH ? `${flat.slice(0, COMMAND_WIDTH - 1)}…` : flat
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${seconds % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function fileActions(entry: FileEntry): string {
  const order: FileAction[] = ["created", "edited", "deleted", "read"]
  return order
    .filter((a) => entry.actions[a] !== undefined)
    .map((a) => {
      const n = entry.actions[a] ?? 0
      return n > 1 ? `${a} ×${n}` : a
    })
    .join(", ")
}

function section<T>(
  title: string,
  items: readonly T[],
  line: (item: T) => string,
  limit: number,
): string[] {
  if (items.length === 0) return []
  const out = ["", title]
  for (const item of items.slice(0, limit)) out.push(`  ${line(item)}`)
  if (items.length > limit) out.push(`  … ${items.length - limit} more (use --all)`)
  return out
}

export function renderReport(report: Report, options: RenderOptions = {}): string {
  const limit = options.all ? Number.POSITIVE_INFINITY : (options.limit ?? DEFAULT_LIMIT)
  const lines: string[] = [`Session ${report.sessionID}`]

  const meta: string[] = []
  if (report.startedAt !== undefined) meta.push(`started ${report.startedAt}`)
  if (report.durationSeconds !== undefined)
    meta.push(`active ${formatDuration(report.durationSeconds)}`)
  if (meta.length > 0) lines.push(meta.join(" · "))
  if (report.directory !== undefined) lines.push(report.directory)

  const changed = report.files.filter((f) => f.changed)
  const readOnly = report.files.filter((f) => !f.changed)
  const failed = report.commands.filter((c) => c.exitCode !== undefined && c.exitCode !== 0).length

  lines.push(
    "",
    [
      `${plural(changed.length, "file")} changed`,
      `${plural(readOnly.length, "file")} read only`,
      plural(report.commands.length, "command"),
      `${report.network.length} network ${report.network.length === 1 ? "target" : "targets"}`,
    ].join(" · "),
  )

  if (
    report.counts.file + report.counts.command + report.counts.network + report.counts.tool ===
    0
  ) {
    lines.push("", "Nothing recorded for this session yet.")
    return `${lines.join("\n")}\n`
  }

  lines.push(
    ...section("Changed files", changed, (f) => `${f.path}  (${fileActions(f)})`, limit),
    ...section(
      "Read files",
      readOnly,
      (f) => {
        const ranged = f.rangedReads > 0 ? `, ${f.rangedReads} partial` : ""
        return `${f.path}  (${fileActions(f)}${ranged})`
      },
      limit,
    ),
    ...section(
      failed > 0 ? `Commands (${failed} failed)` : "Commands",
      report.commands,
      (c) => {
        const status =
          c.exitCode === undefined ? "" : c.exitCode === 0 ? "" : `  [exit ${c.exitCode}]`
        return `$ ${oneLine(c.command)}${status}`
      },
      limit,
    ),
    ...section(
      report.network.some((n) => n.confidence === "guessed")
        ? "Network (guessed entries are hints from commands, not proof)"
        : "Network",
      report.network,
      (n) => {
        const times = n.count > 1 ? ` ×${n.count}` : ""
        const tag = n.confidence === "reported" ? "" : `  [${n.confidence}]`
        return `${n.target}${times}${tag}`
      },
      limit,
    ),
    ...section(
      "Other tools",
      report.tools,
      (t) =>
        `${t.name}${t.count > 1 ? ` ×${t.count}` : ""}${t.category === "external" ? "  [external]" : ""}`,
      limit,
    ),
  )

  return `${lines.join("\n")}\n`
}
