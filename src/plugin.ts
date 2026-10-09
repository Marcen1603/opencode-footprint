/**
 * Server-Plugin (Lite-Edition): hört auf OpenCode-Hooks/-Events und schreibt den Footprint.
 * Eingebunden über opencode.json → "plugins": ["opencode-footprint"].
 *
 * Zielplattform: OpenCode V2 (`@opencode/plugin` 2.x). V1-Plugins laufen auf V2 nicht.
 */
import { Plugin } from "@opencode/plugin"
import { createEvent, type EventInput, RUN_ID_ENV } from "./schema.js"
import { appendEvent } from "./store.js"

export const PLUGIN_ID = "opencode-footprint"

export default Plugin.define({
  id: PLUGIN_ID,
  setup(ctx) {
    const directory = ctx.location.directory
    const runID = process.env[RUN_ID_ENV]

    const write = async (input: EventInput): Promise<void> => {
      try {
        await appendEvent(directory, createEvent(runID ? { ...input, runID } : input))
      } catch (error) {
        // Der Footprint darf die Agent-Session niemals stören.
        console.error(`[${PLUGIN_ID}] failed to write event`, error)
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

    // TODO(v1): ctx.tool.hook("execute.before" | "execute.after") → bash (Commands + Netzwerk-Heuristik),
    //           read/edit/write (Dateien). Beide Hooks tragen sessionID; file.edited nicht.

    return () => abort.abort()
  },
})
