/**
 * Storage of footprint files: one JSONL file per session.
 * Shared by all writers and readers so that paths never diverge.
 */
import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { type FootprintEvent, parseJsonl, serialize } from "./schema.js"

/** Relative to the project directory (see .gitignore). */
export const FOOTPRINT_DIR = join(".opencode", "footprint")
export const FILE_SUFFIX = ".footprint.jsonl"

export function footprintDir(projectDir: string): string {
  return join(projectDir, FOOTPRINT_DIR)
}

/** Session IDs end up in file names – everything except [A-Za-z0-9_-] is replaced. */
export function safeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, "_")
  if (cleaned === "") throw new Error("empty session id")
  return cleaned
}

export function sessionFile(projectDir: string, sessionID: string): string {
  return join(footprintDir(projectDir), `${safeId(sessionID)}${FILE_SUFFIX}`)
}

export async function appendEvent(projectDir: string, event: FootprintEvent): Promise<void> {
  await mkdir(footprintDir(projectDir), { recursive: true })
  await appendFile(sessionFile(projectDir, event.sessionID), serialize(event), "utf8")
}

export async function readSession(
  projectDir: string,
  sessionID: string,
): Promise<FootprintEvent[]> {
  try {
    return parseJsonl(await readFile(sessionFile(projectDir, sessionID), "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

/** All known session IDs of a project, oldest first (by last modification). */
export async function listSessions(projectDir: string): Promise<string[]> {
  const dir = footprintDir(projectDir)
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(FILE_SUFFIX))
    const withTime = await Promise.all(
      files.map(async (f) => ({
        id: f.slice(0, -FILE_SUFFIX.length),
        mtime: (await stat(join(dir, f))).mtimeMs,
      })),
    )
    return withTime.sort((a, b) => a.mtime - b.mtime).map((s) => s.id)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}
