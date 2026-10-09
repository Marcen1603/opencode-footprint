/**
 * Turns OpenCode tool calls into footprint events.
 *
 * Pure and free of OpenCode imports so it can be unit-tested without a running agent.
 *
 * Built-in V2 tools with their own event kinds: `shell`, `read`, `edit`, `write`, `patch`,
 * `webfetch`, `websearch` (`bash` is accepted as an alias). Every other tool (glob, grep, MCP and
 * plugin tools, subagents, ...) becomes a `tool` event that records only its name. Input field names are matched leniently because the V2 docs do not
 * name every field (see `pathOf`).
 */
import { isAbsolute, relative, resolve } from "node:path"
import { detectNetwork, redactCommand } from "./network.js"
import type { EventInput } from "./schema.js"

export interface ToolCall {
  tool: string
  input: unknown
  sessionID: string
  /** Project directory; paths are reported relative to it where possible. */
  directory: string
  /** Does this absolute path exist right now? Used to tell file creation from modification. */
  exists?: (absolutePath: string) => boolean
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function pathOf(input: Record<string, unknown>): string | undefined {
  return text(input.filePath) ?? text(input.file_path) ?? text(input.path) ?? text(input.file)
}

/** Project-relative path with forward slashes, or the absolute path if it lies outside. */
export function displayPath(directory: string, path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(directory, path)
  const rel = relative(directory, absolute)
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
  return (inside ? rel : absolute).replace(/\\/g, "/")
}

export function extractToolEvents(call: ToolCall): EventInput[] {
  const base = { sessionID: call.sessionID, source: "plugin" } as const
  const input = record(call.input)

  switch (call.tool.toLowerCase()) {
    case "bash":
    case "shell": {
      const command = text(input.command)
      if (command === undefined) return []
      const cwd = text(input.workdir) ?? text(input.cwd)
      const events: EventInput[] = [
        {
          ...base,
          confidence: "hook",
          kind: "command",
          command: redactCommand(command),
          ...(cwd ? { cwd } : {}),
        },
      ]
      for (const target of detectNetwork(command)) {
        events.push({
          ...base,
          confidence: "inferred",
          kind: "network",
          target,
          via: "bash-heuristic",
          command: redactCommand(command),
        })
      }
      return events
    }
    case "read": {
      const path = pathOf(input)
      if (path === undefined) return []
      const offset = count(input.offset)
      const limit = count(input.limit)
      const range = {
        ...(offset !== undefined ? { offset } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }
      return [
        {
          ...base,
          confidence: "hook",
          kind: "file",
          action: "read",
          path: displayPath(call.directory, path),
          ...(Object.keys(range).length > 0 ? { range } : {}),
        },
      ]
    }
    case "edit":
    case "multiedit":
      return fileEvent(call, base, pathOf(input), "edited")
    case "write": {
      const path = pathOf(input)
      if (path === undefined) return []
      const absolute = isAbsolute(path) ? path : resolve(call.directory, path)
      const existed = call.exists?.(absolute) ?? true
      return fileEvent(call, base, path, existed ? "edited" : "created")
    }
    case "patch":
      return patchEvents(call, base, text(input.patchText) ?? text(input.patch))
    case "websearch":
      return [{ ...base, confidence: "hook", kind: "network", target: "web search", via: "tool" }]
    case "webfetch": {
      const url = text(input.url)
      if (url === undefined) return []
      let target = url
      try {
        target = new URL(url).hostname || url
      } catch {
        // keep the raw value
      }
      return [{ ...base, confidence: "hook", kind: "network", target, via: "tool" }]
    }
    default:
      return toolEvent(call.tool, base)
  }
}

/** Built-in tools without their own event kind; everything else counts as external. */
const OTHER_BUILTIN_TOOLS = new Set(["glob", "grep", "question", "skill", "subagent", "execute"])
const MAX_TOOL_NAME = 200

function toolEvent(
  name: string,
  base: { readonly sessionID: string; readonly source: "plugin" },
): EventInput[] {
  if (name === "") return []
  return [
    {
      ...base,
      confidence: "hook",
      kind: "tool",
      name: name.slice(0, MAX_TOOL_NAME),
      category: OTHER_BUILTIN_TOOLS.has(name.toLowerCase()) ? "builtin" : "external",
    },
  ]
}

function fileEvent(
  call: ToolCall,
  base: { readonly sessionID: string; readonly source: "plugin" },
  path: string | undefined,
  action: "created" | "edited",
): EventInput[] {
  if (path === undefined) return []
  return [
    { ...base, confidence: "hook", kind: "file", action, path: displayPath(call.directory, path) },
  ]
}

const PATCH_SECTION = /^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$/gm
const PATCH_MOVE = /^\*\*\* Move to:\s*(.+?)\s*$/gm

/** One `patch` call can touch several files: `*** Add File:`, `*** Update File:`, `*** Delete File:`. */
function patchEvents(
  call: ToolCall,
  base: { readonly sessionID: string; readonly source: "plugin" },
  patchText: string | undefined,
): EventInput[] {
  if (patchText === undefined) return []
  const actions = { Add: "created", Update: "edited", Delete: "deleted" } as const
  const events: EventInput[] = []
  for (const match of patchText.matchAll(PATCH_SECTION)) {
    const kind = match[1] as keyof typeof actions
    const path = match[2]
    if (path === undefined) continue
    events.push({
      ...base,
      confidence: "hook",
      kind: "file",
      action: actions[kind],
      path: displayPath(call.directory, path),
    })
  }
  for (const match of patchText.matchAll(PATCH_MOVE)) {
    const path = match[1]
    if (path === undefined) continue
    events.push({
      ...base,
      confidence: "hook",
      kind: "file",
      action: "edited",
      path: displayPath(call.directory, path),
    })
  }
  return events
}
