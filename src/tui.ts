/**
 * TUI-Plugin: Live-Ansicht des Footprints während der Session.
 * Wird von OpenCode V2 über den Subpath-Export "./tui" dieses Pakets geladen
 * (zusammen mit dem Server-Plugin aus opencode.json → "plugins").
 *
 * Noch ein Platzhalter. Geplant: Slot "sidebar.content" (pro sessionID) mit Zusammenfassung;
 * Datenquelle: context.data.on(...) bzw. context.data.listen(...) für Live-Events.
 */
import { Plugin } from "@opencode/plugin/tui"

export const PLUGIN_ID = "opencode-footprint"

export default Plugin.define({
  id: PLUGIN_ID,
  setup() {
    // TODO(v1): context.ui.slot({ append: "sidebar.content", render: … }) registrieren
  },
})
