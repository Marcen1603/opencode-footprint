import { describe, expect, test } from "bun:test"
import { createEvent, parseJsonl, parseLine, SCHEMA_VERSION, serialize } from "../src/schema.js"

const input = {
  kind: "command",
  command: "curl https://example.com",
  sessionID: "ses_1",
  source: "plugin",
  confidence: "hook",
} as const

describe("schema", () => {
  test("createEvent sets version and timestamp", () => {
    const e = createEvent(input, new Date("2026-01-01T00:00:00Z"))
    expect(e.v).toBe(SCHEMA_VERSION)
    expect(e.ts).toBe("2026-01-01T00:00:00.000Z")
  })

  test("serialize → parseLine is lossless", () => {
    const e = createEvent(input)
    const line = serialize(e)
    expect(line.endsWith("\n")).toBe(true)
    expect(parseLine(line)).toEqual(e)
  })

  test("broken and unknown lines are skipped", () => {
    const good = serialize(createEvent(input))
    const content = [
      good,
      "{not json",
      JSON.stringify({ v: 99, kind: "file" }),
      JSON.stringify({ ...createEvent(input), confidence: "guess" }),
      "",
      good,
    ].join("\n")
    expect(parseJsonl(content)).toHaveLength(2)
  })
})

describe("tool events", () => {
  test("tool entries survive a round trip", () => {
    const e = createEvent({
      kind: "tool",
      name: "confluence_search",
      category: "external",
      sessionID: "ses_1",
      source: "plugin",
      confidence: "hook",
    })
    expect(parseLine(serialize(e))).toEqual(e)
  })
})
