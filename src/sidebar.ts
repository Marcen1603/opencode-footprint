/**
 * Compact, sidebar-sized view of a footprint report.
 *
 * Pure text (no OpenTUI imports) so it can be unit-tested; `tui.tsx` only turns the lines into
 * elements. Differs from `renderReport` in being short: a sidebar is ~40 columns wide and shares
 * the screen with the conversation.
 */
import type { Report } from "./report.js"

export interface SidebarLine {
  text: string
  /** Section headings and hints are drawn in the muted theme color. */
  muted?: boolean
}

export interface SidebarOptions {
  /** Max visible characters per line. Default 36. */
  width?: number
  /** Max entries per section (most recent first for commands). Default 4. */
  limit?: number
}

const DEFAULT_WIDTH = 36
const DEFAULT_LIMIT = 4

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

  const changed = report.files.filter((f) => f.changed)
  const readOnly = report.files.filter((f) => !f.changed)
  const recorded =
    report.counts.file + report.counts.command + report.counts.network + report.counts.tool

  if (recorded === 0) {
    lines.push({ text: "Nothing recorded yet.", muted: true })
    return lines
  }

  lines.push(
    { text: `${plural(changed.length, "file")} changed · ${readOnly.length} read` },
    { text: `${plural(report.commands.length, "command")} · ${report.network.length} network` },
  )

  const more = (shown: number, total: number): SidebarLine[] =>
    total > shown ? [{ text: `  … ${total - shown} more`, muted: true }] : []

  if (changed.length > 0) {
    lines.push({ text: "Changed", muted: true })
    for (const f of changed.slice(0, limit)) lines.push({ text: `  ${clip(f.path, width - 2)}` })
    lines.push(...more(limit, changed.length))
  }

  if (report.commands.length > 0) {
    lines.push({ text: "Commands (latest)", muted: true })
    for (const c of report.commands.slice(-limit).reverse()) {
      const status = c.exitCode !== undefined && c.exitCode !== 0 ? ` [exit ${c.exitCode}]` : ""
      lines.push({ text: `  $ ${clip(c.command, width - 4 - status.length)}${status}` })
    }
    lines.push(...more(limit, report.commands.length))
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

  if (report.tools.length > 0) {
    const names = report.tools.map((t) => (t.count > 1 ? `${t.name} ×${t.count}` : t.name))
    lines.push(
      { text: "Other tools", muted: true },
      { text: `  ${clip(names.join(", "), width - 2)}` },
    )
  }

  return lines.map((l) =>
    l.text.length > width ? { ...l, text: `${l.text.slice(0, width - 1)}…` } : l,
  )
}
