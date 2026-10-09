import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { displayPath, extractToolEvents } from "../src/extract.js"

const directory = join("/work", "project")
const base = { sessionID: "ses_1", directory }

describe("extractToolEvents", () => {
  test("bash yields a command and inferred network events", () => {
    const events = extractToolEvents({
      ...base,
      tool: "bash",
      input: { command: "curl https://example.com/x" },
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: "command",
      command: "curl https://example.com/x",
      confidence: "hook",
    })
    expect(events[1]).toMatchObject({
      kind: "network",
      target: "example.com",
      via: "bash-heuristic",
      confidence: "inferred",
    })
  })

  test("bash redacts credentials in the stored command", () => {
    const [event] = extractToolEvents({
      ...base,
      tool: "bash",
      input: { command: "git clone https://u:pw@github.com/a/b.git" },
    })
    expect(event).toMatchObject({
      kind: "command",
      command: "git clone https://***@github.com/a/b.git",
    })
  })

  test("read reports the path and optional line range", () => {
    const [event] = extractToolEvents({
      ...base,
      tool: "read",
      input: { filePath: join(directory, "src", "a.ts"), offset: 10, limit: 50 },
    })
    expect(event).toMatchObject({
      kind: "file",
      action: "read",
      path: "src/a.ts",
      range: { offset: 10, limit: 50 },
    })
  })

  test("accepts alternative input field names", () => {
    const [event] = extractToolEvents({ ...base, tool: "edit", input: { file_path: "src/b.ts" } })
    expect(event).toMatchObject({ kind: "file", action: "edited", path: "src/b.ts" })
  })

  test("write distinguishes creating from modifying", () => {
    const created = extractToolEvents({
      ...base,
      tool: "write",
      input: { filePath: "new.txt" },
      exists: () => false,
    })
    const edited = extractToolEvents({
      ...base,
      tool: "write",
      input: { filePath: "old.txt" },
      exists: () => true,
    })
    expect(created[0]).toMatchObject({ action: "created", path: "new.txt" })
    expect(edited[0]).toMatchObject({ action: "edited", path: "old.txt" })
  })

  test("webfetch is a network event from the tool itself", () => {
    const [event] = extractToolEvents({
      ...base,
      tool: "webfetch",
      input: { url: "https://docs.example.com/page" },
    })
    expect(event).toMatchObject({
      kind: "network",
      target: "docs.example.com",
      via: "tool",
      confidence: "hook",
    })
  })

  test("the V2 shell tool is handled like bash", () => {
    const events = extractToolEvents({ ...base, tool: "shell", input: { command: "git push" } })
    expect(events[0]).toMatchObject({ kind: "command", command: "git push" })
    expect(events[1]).toMatchObject({ kind: "network", target: "git remote" })
  })

  test("patch yields one file event per section", () => {
    const patchText = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export {}",
      "*** Update File: src/old.ts",
      "*** Move to: src/renamed.ts",
      "*** Delete File: src/gone.ts",
      "*** End Patch",
    ].join("\n")
    const events = extractToolEvents({ ...base, tool: "patch", input: { patchText } })
    expect(events.map((e) => (e.kind === "file" ? `${e.action}:${e.path}` : e.kind))).toEqual([
      "created:src/new.ts",
      "edited:src/old.ts",
      "deleted:src/gone.ts",
      "edited:src/renamed.ts",
    ])
  })

  test("websearch is a network event from the tool itself", () => {
    const [event] = extractToolEvents({ ...base, tool: "websearch", input: { query: "bun test" } })
    expect(event).toMatchObject({ kind: "network", target: "web search", via: "tool" })
  })

  test("other built-in tools are recorded by name only", () => {
    const [event] = extractToolEvents({ ...base, tool: "grep", input: { pattern: "secret-token" } })
    expect(event).toMatchObject({
      kind: "tool",
      name: "grep",
      category: "builtin",
      confidence: "hook",
    })
    expect(JSON.stringify(event)).not.toContain("secret-token")
  })

  test("unknown tools such as MCP tools are external", () => {
    const [event] = extractToolEvents({ ...base, tool: "confluence_search", input: { query: "q" } })
    expect(event).toMatchObject({ kind: "tool", name: "confluence_search", category: "external" })
  })

  test("malformed input produces nothing", () => {
    expect(extractToolEvents({ ...base, tool: "", input: {} })).toEqual([])
    expect(extractToolEvents({ ...base, tool: "bash", input: null })).toEqual([])
    expect(extractToolEvents({ ...base, tool: "read", input: "oops" })).toEqual([])
  })
})

describe("displayPath", () => {
  test("keeps project paths relative and outside paths absolute", () => {
    expect(displayPath(directory, join(directory, "a", "b.ts"))).toBe("a/b.ts")
    expect(displayPath(directory, "a/b.ts")).toBe("a/b.ts")
    expect(displayPath(directory, join("/etc", "hosts"))).toBe(
      join("/etc", "hosts").replace(/\\/g, "/"),
    )
  })
})
