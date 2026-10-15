/**
 * TUI plugin: live view of the footprint in the session sidebar.
 *
 * Loaded by OpenCode V2 through this package's "./tui" subpath export, together with the server
 * plugin from opencode.json → "plugins". Shipped as source (.tsx) because OpenCode compiles the
 * OpenTUI/Solid JSX itself; `tsc` only type-checks this file.
 *
 * Data source: the same JSONL file the server plugin writes. v1 polls it every 1.5 s, which is
 * cheap (one small file) and independent of event names; `context.data.on(...)` is the later,
 * push-based alternative.
 */
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal, For, onCleanup, onMount } from "solid-js"
import { buildReport } from "./report.js"
import { type SidebarLine, sidebarLines } from "./sidebar.js"
import { readSession } from "./store.js"

export const PLUGIN_ID = "opencode-footprint"
const POLL_MS = 1500

function Footprint(props: { sessionID: string; directory: string }) {
  const context = usePlugin()
  const [lines, setLines] = createSignal<SidebarLine[]>([])

  const refresh = async (): Promise<void> => {
    try {
      const events = await readSession(props.directory, props.sessionID)
      setLines(sidebarLines(buildReport(props.sessionID, events)))
    } catch {
      // A sidebar must never break the UI; keep showing the last good state.
    }
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box flexDirection="column">
      <For each={lines()}>
        {(line) => (
          <text fg={line.muted ? context.theme.text.muted : context.theme.text.base}>
            {line.text}
          </text>
        )}
      </For>
    </box>
  )
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    const directory = (context.location ?? context.data.location.default()).directory
    return context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <Footprint sessionID={sessionID} directory={directory} />,
    })
  },
})
