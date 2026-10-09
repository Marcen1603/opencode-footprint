/**
 * Server plugin (lite edition): listens to OpenCode hooks/events and writes the footprint.
 * Enabled via opencode.json → "plugins": ["opencode-footprint"].
 *
 * Target platform: OpenCode V2 (`@opencode/plugin` 2.x). V1 plugins do not run on V2.
 *
 * Debug mode: set OPENCODE_FOOTPRINT_DEBUG=1 to also dump the raw tool-hook payloads to
 * `.opencode/footprint/debug.jsonl`. Useful for checking tool names and input shapes.
 */
import { existsSync } from "node:fs"
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { extractToolEvents } from "./extract.js"
import { createEvent, type EventInput, RUN_ID_ENV } from "./schema.js"
import { appendEvent, footprintDir } from "./store.js"

export const PLUGIN_ID = "opencode-footprint"
export const DEBUG_ENV = "OPENCODE_FOOTPRINT_DEBUG"

const DEBUG_LIMIT = 2000

function clip(value: unknown): unknown {
  try {
    const json = JSON.stringify(value)
    if (json === undefined || json.length <= DEBUG_LIMIT) return value
    return `${json.slice(0, DEBUG_LIMIT)}… (${json.length} chars)`
  } catch {
    return String(value)
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const directory = ctx.location.directory
    const runID = process.env[RUN_ID_ENV]
    const debug = process.env[DEBUG_ENV] === "1"

    const write = async (input: EventInput): Promise<void> => {
      try {
        await appendEvent(directory, createEvent(runID ? { ...input, runID } : input))
      } catch (error) {
        // The footprint must never disturb the agent session.
        console.error(`[${PLUGIN_ID}] failed to write event`, error)
      }
    }

    const writeDebug = async (entry: Record<string, unknown>): Promise<void> => {
      if (!debug) return
      try {
        await mkdir(footprintDir(directory), { recursive: true })
        const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`
        await appendFile(join(footprintDir(directory), "debug.jsonl"), line, "utf8")
      } catch (error) {
        console.error(`[${PLUGIN_ID}] failed to write debug entry`, error)
      }
    }

    const abort = new AbortController()

    const consume = async (): Promise<void> => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        switch (event.type) {
          case "session.created":
            await write({
              kind: "session",
              action: "started",
              sessionID: event.data.sessionID,
              directory,
              source: "plugin",
              confidence: "hook",
            })
            break
          case "session.idle":
            await write({
              kind: "session",
              action: "idle",
              sessionID: event.data.sessionID,
              source: "plugin",
              confidence: "hook",
            })
            break
        }
      }
    }

    consume().catch((error: unknown) => {
      if (!abort.signal.aborted) console.error(`[${PLUGIN_ID}] event stream failed`, error)
    })

    // Both tool hooks carry a sessionID (file.edited does not), so files and commands are
    // attributed from the tool call. Hooks must never throw into the agent.
    const before = await ctx.tool.hook("execute.before", async (input) => {
      try {
        await writeDebug({ hook: "execute.before", tool: input.tool, input: clip(input.input) })
        const events = extractToolEvents({
          tool: input.tool,
          input: input.input,
          sessionID: input.sessionID,
          directory,
          exists: existsSync,
        })
        for (const event of events) await write(event)
      } catch (error) {
        console.error(`[${PLUGIN_ID}] execute.before failed`, error)
      }
    })

    // TODO(v1): use execute.after for exit codes once the result shape is known (see debug mode).
    const after = await ctx.tool.hook("execute.after", async (input) => {
      await writeDebug({
        hook: "execute.after",
        tool: input.tool,
        status: input.status,
        ...(input.status === "completed"
          ? { result: clip(input.result) }
          : { error: clip(input.error) }),
      })
    })

    return async () => {
      abort.abort()
      await Promise.all([before.dispose(), after.dispose()])
    }
  },
})
