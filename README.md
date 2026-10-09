# opencode-footprint

A lightweight, readable footprint of what your OpenCode agent actually did — files touched, commands run, network access — in seconds, no raw logs, no Docker.

> **Status:** early development (v0). The package layout and event schema are in place; tracking is being implemented.

## How it works

One package, three entry points, one shared file format:

| Entry point | Role | Loaded via |
|---|---|---|
| `opencode-footprint` (server plugin) | Writes a JSONL footprint per session | `opencode.json` |
| `opencode-footprint/tui` (TUI plugin) | Live sidebar during the session | loaded automatically from the same package |
| `opencode-footprint` CLI | Reports for past sessions | `npx` / `bunx` |

Footprints are stored per project in `.opencode/footprint/<session-id>.footprint.jsonl`.

Every entry carries a `confidence` field — `hook` (reported by OpenCode), `inferred` (heuristic, e.g. network access parsed from a shell command) or `observed` (reserved for a future wrapper mode that watches OpenCode independently).

## Installation

```jsonc
// opencode.json
{ "plugins": ["opencode-footprint"] }
```

The `./tui` export is picked up automatically; no separate TUI config entry is needed.

```sh
npx opencode-footprint sessions
npx opencode-footprint report [session-id]
```

**Compatibility:** targets **OpenCode V2** (`@opencode/plugin` 2.x, developed against 2.0.26). OpenCode V1 plugins do not run on V2 and V1 is not supported.

## Development

Requires [Bun](https://bun.sh) (version pinned via `packageManager` in `package.json`).

```sh
bun install
bun run typecheck
bun run lint        # bun run format to auto-fix
bun test
bun run build
```

```
src/
  schema.ts   shared event format (contract between writers and readers)
  store.ts    file locations, append/read of session JSONL
  report.ts   aggregation for CLI and TUI
  plugin.ts   server plugin (writer)
  tui.ts      TUI plugin (reader)
  cli.ts      CLI (reader; later: `run` wrapper mode)
```

## License

[MIT](LICENSE)
