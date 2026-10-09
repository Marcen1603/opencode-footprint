#!/usr/bin/env node
/**
 * CLI: nachträglicher Report für vergangene Sessions.
 * Später zusätzlich `run`: startet OpenCode als Kindprozess und beobachtet unabhängig (Capsule).
 */
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { summarize } from "./report.js"
import { listSessions, readSession } from "./store.js"

const HELP = `opencode-footprint – was hat der Agent in dieser Session gemacht?

Usage:
  opencode-footprint sessions              Sessions im aktuellen Projekt auflisten
  opencode-footprint report [session-id]   Report einer Session (Standard: neueste)
  opencode-footprint run [-- opencode-args] OpenCode mit unabhängiger Beobachtung starten (geplant)

Options:
  -C, --dir <path>   Projektverzeichnis (Standard: aktuelles Verzeichnis)
  -h, --help         Hilfe anzeigen
  -v, --version      Version anzeigen
`

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  return String(pkg.version)
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: "string", short: "C" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  })

  if (values.version) {
    console.log(version())
    return 0
  }
  const [command, ...rest] = positionals
  if (values.help || command === undefined) {
    console.log(HELP)
    return 0
  }

  const dir = values.dir ?? process.cwd()

  switch (command) {
    case "sessions": {
      const sessions = await listSessions(dir)
      if (sessions.length === 0) console.log("Keine Footprints gefunden.")
      for (const id of sessions) console.log(id)
      return 0
    }
    case "report": {
      const sessions = await listSessions(dir)
      const id = rest[0] ?? sessions.at(-1)
      if (id === undefined) {
        console.error("Keine Footprints gefunden.")
        return 1
      }
      const counts = summarize(await readSession(dir, id))
      console.log(`Session ${id}`)
      console.log(`  Dateien:   ${counts.file}`)
      console.log(`  Befehle:   ${counts.command}`)
      console.log(`  Netzwerk:  ${counts.network}`)
      // TODO(v1): lesbare Zusammenfassung statt Zähler
      return 0
    }
    case "run":
      console.error("`run` (Capsule-Edition) ist noch nicht implementiert.")
      return 2
    default:
      console.error(`Unbekannter Befehl: ${command}\n\n${HELP}`)
      return 1
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  },
)
