/**
 * TUI plugin: live view of the footprint during the session.
 * Loaded by OpenCode V2 through this package's "./tui" subpath export
 * (together with the server plugin from opencode.json → "plugins").
 *
 * Still a placeholder. Planned: slot "sidebar.content" (per sessionID) with a summary;
 * data source: context.data.on(...) / context.data.listen(...) for live events.
 */
import { Plugin } from "@opencode/plugin/tui"

export const PLUGIN_ID = "opencode-footprint"

export default Plugin.define({
  id: PLUGIN_ID,
  setup() {
    // TODO(v1): register context.ui.slot({ append: "sidebar.content", render: … })
  },
})
