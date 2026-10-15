import { describe, expect, test } from "bun:test"
import { buildReport, formatDuration, renderReport } from "../src/report.js"
import { createEvent, type EventInput } from "../src/schema.js"

const base = { sessionID: "s1", source: "plugin", confidence: "reported" } as const

type Payload = EventInput extends infer E
  ? E extends EventInput
    ? Omit<E, "sessionID" | "source" | "confidence">
    : never
  : never

function at(second: number, input: Payload) {
  return createEvent(
    { ...base, ...input } as EventInput,
    new Date(Date.UTC(2026, 9, 10, 12, 0, second)),
  )
}

const events = [
  at(0, { kind: "session", action: "started", directory: "/proj" }),
  at(5, { kind: "file", action: "read", path: "src/a.ts" }),
  at(6, { kind: "file", action: "read", path: "src/a.ts", range: { offset: 10, limit: 20 } }),
  at(10, { kind: "file", action: "edited", path: "src/a.ts" }),
  at(11, { kind: "file", action: "created", path: "hello.txt" }),
  at(12, { kind: "command", command: "bun test\n  --bail", exitCode: 1 }),
  at(13, { kind: "command", command: "curl https://example.com" }),
  {
    ...at(13, {
      kind: "network",
      target: "example.com",
      via: "bash-heuristic",
      command: "curl https://example.com",
    }),
    confidence: "guessed" as const,
  },
  at(14, { kind: "tool", name: "grep", category: "builtin" }),
  at(15, { kind: "tool", name: "grep", category: "builtin" }),
  at(75, { kind: "session", action: "idle" }),
]

describe("buildReport", () => {
  const report = buildReport("s1", events)

  test("splits changed from read-only files and counts actions", () => {
    expect(report.files.map((f) => [f.path, f.changed])).toEqual([
      ["hello.txt", true],
      ["src/a.ts", true],
    ])
    const a = report.files.find((f) => f.path === "src/a.ts")
    expect(a?.actions).toEqual({ read: 2, edited: 1 })
    expect(a?.rangedReads).toBe(1)
  })

  test("collects commands, tools and network targets", () => {
    expect(report.commands).toHaveLength(2)
    expect(report.tools).toEqual([{ name: "grep", category: "builtin", count: 2 }])
    expect(report.network[0]).toMatchObject({ target: "example.com", count: 1 })
  })

  test("derives directory and duration", () => {
    expect(report.directory).toBe("/proj")
    expect(report.durationSeconds).toBe(75)
  })

  test("empty input yields an empty report", () => {
    const empty = buildReport("x", [])
    expect(empty.files).toEqual([])
    expect(empty.durationSeconds).toBeUndefined()
  })
})

describe("renderReport", () => {
  test("renders sections, failed commands and guessed hints", () => {
    const out = renderReport(buildReport("s1", events))
    expect(out).toContain("Session s1")
    expect(out).toContain("active 1m 15s")
    expect(out).toContain("2 files changed")
    expect(out).toContain("src/a.ts  (edited, read ×2)")
    expect(out).toContain("Commands (1 failed)")
    expect(out).toContain("$ bun test --bail  [exit 1]")
    expect(out).toContain("example.com  [guessed]")
    expect(out).toContain("grep ×2")
  })

  test("collapses long sections unless --all", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      at(i, { kind: "command", command: `echo ${i}` }),
    )
    const report = buildReport("s1", many)
    expect(renderReport(report)).toContain("… 5 more (use --all)")
    expect(renderReport(report, { all: true })).not.toContain("more (use --all)")
  })

  test("says so when nothing was recorded", () => {
    const out = renderReport(buildReport("s1", [at(0, { kind: "session", action: "started" })]))
    expect(out).toContain("Nothing recorded")
  })
})

describe("formatDuration", () => {
  test("formats seconds, minutes and hours", () => {
    expect(formatDuration(42)).toBe("42s")
    expect(formatDuration(125)).toBe("2m 5s")
    expect(formatDuration(3660)).toBe("1h 1m")
  })
})
