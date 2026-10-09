/** Aggregation von Footprint-Events zu einem lesbaren Report (von CLI und TUI genutzt). */
import type { FootprintEvent, FootprintKind } from "./schema.js"

export function summarize(events: readonly FootprintEvent[]): Record<FootprintKind, number> {
  const counts: Record<FootprintKind, number> = { session: 0, file: 0, command: 0, network: 0 }
  for (const e of events) counts[e.kind]++
  return counts
}
