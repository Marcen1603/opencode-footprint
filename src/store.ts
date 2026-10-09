/**
 * Ablage der Footprint-Dateien: eine JSONL-Datei pro Session.
 * Wird von allen Schreibern und Lesern gemeinsam genutzt, damit Pfade nie auseinanderlaufen.
 */
import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { type FootprintEvent, parseJsonl, serialize } from "./schema.js"

/** Relativ zum Projektverzeichnis (siehe .gitignore). */
export const FOOTPRINT_DIR = join(".opencode", "footprint")
export const FILE_SUFFIX = ".footprint.jsonl"

export function footprintDir(projectDir: string): string {
  return join(projectDir, FOOTPRINT_DIR)
}

/** Session-IDs landen im Dateinamen – alles außer [A-Za-z0-9_-] wird ersetzt. */
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

/** Alle bekannten Session-IDs eines Projekts, älteste zuerst (nach letzter Änderung). */
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
