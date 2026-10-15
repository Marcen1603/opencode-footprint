import { describe, expect, test } from "bun:test"
import { buildReport } from "../src/report.js"
import type { EventInput } from "../src/schema.js"
import { createEvent } from "../src/schema.js"
import { sidebarLines } from "../src/sidebar.js"

const base = { sessionID: "s1", source: "plugin", confidence: "reported" } as const

function report(inputs: EventInput[]) {
  return buildReport(
    "s1",
    inputs.map((i) => createEvent(i)),
  )
}

const texts = (r: ReturnType<typeof report>, o?: Parameters<typeof sidebarLines>[1]) =>
  sidebarLines(r, o).map((l) => l.text)

describe("sidebarLines", () => {
  test("empty session says so", () => {
    expect(texts(report([]))).toEqual(["Footprint", "Nothing recorded yet."])
  })

  test("summarizes counts and sections", () => {
    const lines = texts(
      report([
        { ...base, kind: "file", action: "created", path: "hello.txt" },
        { ...base, kind: "file", action: "read", path: "README.md" },
        { ...base, kind: "command", command: "curl https://example.com" },
        {
          ...base,
          confidence: "guessed",
          kind: "network",
          target: "example.com",
          via: "bash-heuristic",
        },
        { ...base, kind: "tool", name: "grep", category: "builtin" },
      ]),
    )
    expect(lines).toContain("1 file changed · 1 read")
    expect(lines).toContain("1 command · 1 network")
    expect(lines).toContain("  hello.txt")
    expect(lines).toContain("  $ curl https://example.com")
    expect(lines).toContain("Network (guessed)")
    expect(lines).toContain("  example.com")
    expect(lines).toContain("  grep")
  })

  test("shows the latest commands first and collapses the rest", () => {
    const commands: EventInput[] = ["a", "b", "c"].map((c) => ({
      ...base,
      kind: "command",
      command: c,
    }))
    const lines = texts(report(commands), { limit: 2 })
    expect(lines.filter((l) => l.startsWith("  $"))).toEqual(["  $ c", "  $ b"])
    expect(lines).toContain("  … 1 more")
  })

  test("clips long lines to the width", () => {
    const lines = sidebarLines(report([{ ...base, kind: "command", command: "x".repeat(200) }]), {
      width: 20,
    })
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(20)
  })

  test("marks failed commands", () => {
    const lines = texts(report([{ ...base, kind: "command", command: "false", exitCode: 1 }]))
    expect(lines).toContain("  $ false [exit 1]")
  })
})
