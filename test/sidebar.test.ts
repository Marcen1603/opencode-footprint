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

const file = (action: "created" | "edited" | "deleted" | "read", path: string): EventInput => ({
  ...base,
  kind: "file",
  action,
  path,
})

describe("sidebarLines", () => {
  test("empty session says so", () => {
    expect(texts(report([]))).toEqual(["Footprint", "Nothing recorded yet."])
  })

  test("marks each file by outcome, heaviest first", () => {
    const lines = texts(
      report([
        file("read", "README.md"),
        file("edited", "src/b.ts"),
        file("created", "src/a.ts"),
        file("deleted", "old.ts"),
      ]),
    )
    expect(lines).toContain("4 files · 0 commands")
    expect(lines.filter((l) => /^ {2}[-+~·] /.test(l))).toEqual([
      "  - old.ts",
      "  + src/a.ts",
      "  ~ src/b.ts",
      "  · README.md",
    ])
  })

  test("a file's final outcome wins", () => {
    const lines = texts(
      report([
        file("created", "new.ts"),
        file("edited", "new.ts"),
        file("edited", "gone.ts"),
        file("deleted", "gone.ts"),
        file("read", "both.ts"),
        file("edited", "both.ts"),
      ]),
    )
    expect(lines).toContain("  + new.ts")
    expect(lines).toContain("  - gone.ts")
    expect(lines).toContain("  ~ both.ts")
  })

  test("read-only files are muted, changes are not", () => {
    const lines = sidebarLines(report([file("read", "r.ts"), file("edited", "e.ts")]))
    expect(lines.find((l) => l.text === "  · r.ts")?.muted).toBe(true)
    expect(lines.find((l) => l.text === "  ~ e.ts")?.muted).toBeUndefined()
  })

  test("cuts read-only files first and then shows the per-outcome numbers", () => {
    const lines = texts(
      report([
        file("edited", "e.ts"),
        file("read", "r1.ts"),
        file("read", "r2.ts"),
        file("read", "r3.ts"),
      ]),
      { limit: 2 },
    )
    expect(lines).toContain("1 edited · 3 read")
    expect(lines).toContain("  ~ e.ts")
    expect(lines).toContain("  · r1.ts")
    expect(lines).not.toContain("  · r2.ts")
    expect(lines).toContain("  … 2 more")
  })

  test("does not repeat the numbers while the whole list fits", () => {
    const lines = texts(report([file("edited", "e.ts"), file("read", "r.ts")]))
    expect(lines.some((l) => l.includes("1 edited"))).toBe(false)
  })

  test("commands are a number; only failures and the last one are listed", () => {
    const lines = texts(
      report([
        { ...base, kind: "command", command: "ls" },
        { ...base, kind: "command", command: "bun test", exitCode: 1 },
        { ...base, kind: "command", command: "git status" },
      ]),
    )
    expect(lines).toContain("0 files · 3 commands (1 failed)")
    expect(lines).toContain("Failed")
    expect(lines).toContain("  $ bun test [exit 1]")
    expect(lines).toContain("Last: $ git status")
    expect(lines).not.toContain("  $ ls")
  })

  test("a failed last command is not listed twice", () => {
    const lines = texts(report([{ ...base, kind: "command", command: "false", exitCode: 1 }]))
    expect(lines).toContain("  $ false [exit 1]")
    expect(lines.some((l) => l.startsWith("Last:"))).toBe(false)
  })

  test("shows the newest failures first", () => {
    const lines = texts(
      report(["a", "b", "c"].map((c) => ({ ...base, kind: "command", command: c, exitCode: 1 }))),
      { limit: 2 },
    )
    expect(lines.filter((l) => l.startsWith("  $"))).toEqual(["  $ c [exit 1]", "  $ b [exit 1]"])
    expect(lines).toContain("  … 1 more")
  })

  test("lists network hints and only external tools", () => {
    const lines = texts(
      report([
        {
          ...base,
          confidence: "guessed",
          kind: "network",
          target: "example.com",
          via: "bash-heuristic",
        },
        { ...base, kind: "tool", name: "grep", category: "builtin" },
        { ...base, kind: "tool", name: "github_issue", category: "external" },
        { ...base, kind: "tool", name: "github_issue", category: "external" },
      ]),
    )
    expect(lines).toContain("Network (guessed)")
    expect(lines).toContain("  example.com")
    expect(lines).toContain("External tools")
    expect(lines).toContain("  github_issue ×2")
    expect(lines).not.toContain("  grep")
  })

  test("a quiet session stays short", () => {
    const lines = texts(
      report([file("edited", "a.ts"), { ...base, kind: "command", command: "ls" }]),
    )
    expect(lines.length).toBeLessThanOrEqual(6)
  })

  test("clips long lines to the width", () => {
    const lines = sidebarLines(report([file("edited", "x".repeat(200))]), { width: 20 })
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(20)
  })
})
