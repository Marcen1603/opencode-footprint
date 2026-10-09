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

## Testing locally

You can try the plugin end to end without a paid model by running OpenCode V2 against a small local model through [Ollama](https://ollama.com). The plugin only hooks into OpenCode, so any model that supports tool calls is enough to produce footprints.

> **Note:** the plugin records session start/idle, file operations (read, edit, write), shell commands and likely network access. Network entries are heuristics parsed from shell commands and are marked `inferred`. Exit codes are not recorded yet.

### 1. Install OpenCode V2

This package targets OpenCode V2. V1 and V2 both provide the `opencode` command, so remove V1 first if you have it:

```sh
npm uninstall -g opencode-ai
npm install -g @opencode/cli@2.0.26
opencode --version   # should print 2.x
```

Do not use `ollama launch opencode` for this: it may install OpenCode V1 again.

### 2. Set up a local model with Ollama

```sh
ollama pull qwen3:4b
```

- Pick a model that supports tools (check the "tools" tag in the [Ollama library](https://ollama.com/library)). Small models call tools less reliably; if the agent does nothing, try a different model or phrasing before suspecting the plugin.
- Coding agents need a long context. Set the context length in the Ollama app settings; 16k–32k is a realistic range for a GPU with about 11 GB of VRAM.
- To keep large model files off the system drive, set the user environment variable `OLLAMA_MODELS` to a folder on another drive, then restart Ollama.

### 3. Build and load the plugin

```sh
bun install
bun run build
```

Add the built package to the `opencode.json` of the project you want to test in (use an absolute path or `file://` URL to this repository):

```jsonc
{ "plugins": ["file:///path/to/opencode-footprint"] }
```

Then start `opencode` in that project, select your Ollama model and give the agent a small task, for example "create a file hello.txt containing the word test".

### 4. Inspect the footprint

```sh
npx opencode-footprint sessions
npx opencode-footprint report
```

Raw data is written to `.opencode/footprint/<session-id>.footprint.jsonl` in the tested project.

If entries are missing, run OpenCode with `OPENCODE_FOOTPRINT_DEBUG=1` (PowerShell: `$env:OPENCODE_FOOTPRINT_DEBUG=1`). The plugin then also dumps the raw tool-hook payloads to `.opencode/footprint/debug.jsonl`, which shows the real tool names and input fields OpenCode uses.

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
