import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEvent } from "../src/schema.js"
import { appendEvent, listSessions, readSession, safeId } from "../src/store.js"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "footprint-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("store", () => {
  test("appendEvent schreibt pro Session eine Datei", async () => {
    const base = { source: "plugin", confidence: "hook" } as const
    await appendEvent(
      dir,
      createEvent({ ...base, kind: "session", action: "started", sessionID: "a" }),
    )
    await appendEvent(
      dir,
      createEvent({ ...base, kind: "file", action: "edited", path: "x.ts", sessionID: "a" }),
    )
    await appendEvent(
      dir,
      createEvent({ ...base, kind: "session", action: "started", sessionID: "b" }),
    )

    expect(await readSession(dir, "a")).toHaveLength(2)
    expect((await listSessions(dir)).sort()).toEqual(["a", "b"])
  })

  test("fehlende Daten liefern leere Ergebnisse", async () => {
    expect(await listSessions(dir)).toEqual([])
    expect(await readSession(dir, "nope")).toEqual([])
  })

  test("safeId verhindert Pfad-Traversal", () => {
    expect(safeId("../../etc/passwd")).toBe("______etc_passwd")
    expect(() => safeId("")).toThrow()
  })
})
