/**
 * Compact, sidebar-sized view of a footprint report.
 *
 * Pure text (no OpenTUI imports) so it can be unit-tested; `tui.tsx` only turns the lines into
 * elements. A sidebar is ~40 columns wide and shares the screen with the conversation, so it only
 * shows what is worth a glance: files (with a marker per outcome), anything that left the machine
 * (network, external tools) and failures. Everything else is a number; the full list is in
 * `opencode-footprint report`.
 *
 * File markers:  + created   ~ edited   - deleted   · only read
 */
import type { FileEntry, Report } from "./report.js"

export interface SidebarLine {
  text: string
  /** Section headings, hints and read-only files are drawn in the muted theme color. */
  muted?: boolean
}

export interface SidebarOptions {
  /** Max visible characters per line. Default 36. */
  width?: number
  /** Max entries per section. Default 5. */
  limit?: number
}

const DEFAULT_WIDTH = 36
const DEFAULT_LIMIT = 5

const MARKER: Record<FileEntry["state"], string> = {
  created: "+",
  edited: "~",
  deleted: "-",
  read: "·",
}

/** Heaviest first, so the limit cuts read-only files before anything that changed. */
const STATE_ORDER: FileEntry["state"][] = ["deleted", "created", "edited", "read"]

function clip(value: string, width: number): string {
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length > width ? `${flat.slice(0, Math.max(1, width - 1))}…` : flat
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function sidebarLines(report: Report, options: SidebarOptions = {}): SidebarLine[] {
  const width = options.width ?? DEFAULT_WIDTH
  const limit = options.limit ?? DEFAULT_LIMIT
  const lines: SidebarLine[] = [{ text: "Footprint", muted: true }]

  const recorded =
    report.counts.file + report.counts.command + report.counts.network + report.counts.tool

  if (recorded === 0) {
    lines.push({ text: "Nothing recorded yet.", muted: true })
    return lines
  }

  const failed = report.commands.filter((c) => c.exitCode !== undefined && c.exitCode !== 0)
  const failedNote = failed.length > 0 ? ` (${failed.length} failed)` : ""
  lines.push({
    text: `${plural(report.files.length, "file")} · ${plural(report.commands.length, "command")}${failedNote}`,
  })

  const more = (shown: number, total: number): SidebarLine[] =>
    total > shown ? [{ text: `  … ${total - shown} more`, muted: true }] : []

  if (report.files.length > 0) {
    const files = [...report.files].sort(
      (a, b) =>
        STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.path.localeCompare(b.path),
    )

    // Once the list is cut off, the per-outcome numbers are the only way to see what is hidden.
    if (files.length > limit) {
      const parts = STATE_ORDER.flatMap((state) => {
        const n = files.filter((f) => f.state === state).length
        return n > 0 ? [`${n} ${state}`] : []
      })
      lines.push({ text: parts.join(" · "), muted: true })
    }

    lines.push({ text: "Files", muted: true })
    for (const f of files.slice(0, limit)) {
      const line: SidebarLine = { text: `  ${MARKER[f.state]} ${clip(f.path, width - 4)}` }
      if (f.state === "read") line.muted = true
      lines.push(line)
    }
    lines.push(...more(limit, files.length))
  }

  if (report.network.length > 0) {
    const hint = report.network.some((n) => n.confidence === "guessed") ? " (guessed)" : ""
    lines.push({ text: `Network${hint}`, muted: true })
    for (const n of report.network.slice(0, limit)) {
      lines.push({
        text: `  ${clip(n.count > 1 ? `${n.target} ×${n.count}` : n.target, width - 2)}`,
      })
    }
    lines.push(...more(limit, report.network.length))
  }

  // Built-in tools (grep, glob, …) say little; external (MCP) tools reach beyond the machine.
  const external = report.tools.filter((t) => t.category === "external")
  if (external.length > 0) {
    lines.push({ text: "External tools", muted: true })
    for (const t of external.slice(0, limit)) {
      lines.push({ text: `  ${clip(t.count > 1 ? `${t.name} ×${t.count}` : t.name, width - 2)}` })
    }
    lines.push(...more(limit, external.length))
  }

  if (failed.length > 0) {
    lines.push({ text: "Failed", muted: true })
    for (const c of failed.slice(-limit).reverse()) {
      const status = ` [exit ${c.exitCode}]`
      lines.push({ text: `  $ ${clip(c.command, width - 4 - status.length)}${status}` })
    }
    lines.push(...more(limit, failed.length))
  }

  // Live glance at what the agent is doing; skipped when the last command already shows as failed.
  const last = report.commands.at(-1)
  if (last !== undefined && (last.exitCode === undefined || last.exitCode === 0)) {
    lines.push({ text: `Last: $ ${clip(last.command, width - 8)}`, muted: true })
  }

  return lines.map((l) =>
    l.text.length > width ? { ...l, text: `${l.text.slice(0, width - 1)}…` } : l,
  )
}
