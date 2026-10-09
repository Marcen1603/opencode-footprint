#!/usr/bin/env node
/**
 * CLI: after-the-fact report for past sessions.
 * Later also `run`: starts OpenCode as a child process and observes it independently (capsule).
 */
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { summarize } from "./report.js"
import { listSessions, readSession } from "./store.js"

const HELP = `opencode-footprint – what did the agent actually do in this session?

Usage:
  opencode-footprint sessions               List the sessions in the current project
  opencode-footprint report [session-id]    Report for one session (default: most recent)
  opencode-footprint run [-- opencode-args] Start OpenCode with independent observation (planned)

Options:
  -C, --dir <path>   Project directory (default: current directory)
  -h, --help         Show help
  -v, --version      Show version
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
      if (sessions.length === 0) console.log("No footprints found.")
      for (const id of sessions) console.log(id)
      return 0
    }
    case "report": {
      const sessions = await listSessions(dir)
      const id = rest[0] ?? sessions.at(-1)
      if (id === undefined) {
        console.error("No footprints found.")
        return 1
      }
      const counts = summarize(await readSession(dir, id))
      console.log(`Session ${id}`)
      console.log(`  Files:     ${counts.file}`)
      console.log(`  Commands:  ${counts.command}`)
      console.log(`  Network:   ${counts.network}`)
      // TODO(v1): readable summary instead of counters
      return 0
    }
    case "run":
      console.error("`run` (capsule edition) is not implemented yet.")
      return 2
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`)
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
