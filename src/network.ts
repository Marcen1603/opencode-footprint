/**
 * Best-effort detection of network access in shell commands.
 *
 * OpenCode reports no network events, so this is a heuristic: it only looks at the command text.
 * It misses anything a script does internally and may flag commands that never reach the network.
 * Entries derived from it must carry `confidence: "inferred"`.
 */

/** Splits a command line into simple commands (`&&`, `||`, `;`, `|`, newlines). */
const SEGMENT_SEPARATOR = /&&|\|\||[;|\n]/

const WRAPPERS = new Set(["sudo", "env", "time", "command", "nohup", "exec"])
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi
const UNKNOWN_HOST = "(unknown host)"

/** Package-manager subcommands that fetch from a registry. */
const NODE_FETCH = new Set(["install", "i", "add", "update", "upgrade", "ci", "create", "publish"])
const PY_FETCH = new Set(["install", "download", "add", "sync"])

/** Removes credentials from commands before they are written to disk (best effort). */
export function redactCommand(command: string): string {
  return command
    .replace(/(:\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1***@")
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s'"]+/gi, "$1***")
    .replace(/(--?(?:token|password|passwd|api-?key|secret)(?:=|\s+))[^\s'"]+/gi, "$1***")
}

function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname
    return host === "" ? undefined : host
  } catch {
    return undefined
  }
}

function urlHosts(args: string[]): string[] {
  const hosts: string[] = []
  for (const arg of args) {
    for (const match of arg.match(URL_PATTERN) ?? []) {
      const host = hostOf(match)
      if (host) hosts.push(host)
    }
  }
  return hosts
}

/** `user@host:path` or `host:path` as used by git, scp and rsync. */
function scpHost(arg: string): string | undefined {
  const match = /^(?:[^\s@/:]+@)?([A-Za-z0-9.-]+\.[A-Za-z]{2,}|localhost):/.exec(arg)
  return match?.[1]
}

function bareHost(arg: string): string | undefined {
  if (arg.startsWith("-")) return undefined
  const host = arg.includes("@") ? arg.slice(arg.lastIndexOf("@") + 1) : arg
  const cleaned = host.split(":")[0] ?? ""
  return /^[A-Za-z0-9.-]+$/.test(cleaned) && (cleaned.includes(".") || cleaned === "localhost")
    ? cleaned
    : undefined
}

function firstPositional(args: string[]): string | undefined {
  return args.find((a) => !a.startsWith("-"))
}

function detectSegment(segment: string): string[] {
  const tokens = segment.trim().split(/\s+/).filter(Boolean)
  while (tokens[0] !== undefined && (WRAPPERS.has(tokens[0]) || /^[A-Za-z_]\w*=/.test(tokens[0]))) {
    tokens.shift()
  }
  const first = tokens.shift()
  if (first === undefined) return []
  let program = (first.split(/[\\/]/).pop() ?? first).toLowerCase().replace(/\.(exe|cmd)$/, "")
  let args = tokens

  if (/^python[\d.]*$/.test(program) && args[0] === "-m" && args[1] === "pip") {
    program = "pip"
    args = args.slice(2)
  }
  if (program === "uv" && args[0] === "pip") args = args.slice(1)

  const sub = firstPositional(args)
  const urls = urlHosts(args)

  switch (program) {
    case "curl":
    case "wget":
    case "http":
    case "https":
    case "xh":
    case "aria2c": {
      if (urls.length > 0) return urls
      const host = args.map(bareHost).find((h) => h !== undefined)
      return [host ?? UNKNOWN_HOST]
    }
    case "git": {
      if (!sub || !["clone", "fetch", "pull", "push", "ls-remote", "submodule"].includes(sub))
        return []
      if (urls.length > 0) return urls
      const scp = args.map(scpHost).find((h) => h !== undefined)
      return [scp ?? "git remote"]
    }
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      return sub !== undefined && NODE_FETCH.has(sub) ? ["npm registry"] : []
    case "npx":
    case "bunx":
    case "pnpx":
      return ["npm registry"]
    case "pip":
    case "pip3":
    case "pipx":
    case "uv":
      return sub !== undefined && PY_FETCH.has(sub) ? ["PyPI"] : []
    case "cargo":
      return sub !== undefined && ["install", "add", "fetch", "update", "publish"].includes(sub)
        ? ["crates.io"]
        : []
    case "go":
      return sub !== undefined && ["get", "install"].includes(sub) ? ["Go module proxy"] : []
    case "docker":
      return sub !== undefined && ["pull", "push", "login"].includes(sub)
        ? ["container registry"]
        : []
    case "ssh":
    case "scp":
    case "sftp":
    case "rsync": {
      // A remote is `user@host`, `host:path` or (for ssh only) a bare host. File names such as
      // `file.txt` must not count as hosts.
      const remote = args.find(
        (a) => !a.startsWith("-") && (a.includes("@") || scpHost(a) !== undefined),
      )
      const host =
        remote !== undefined
          ? (scpHost(remote) ?? bareHost(remote))
          : program === "ssh"
            ? bareHost(firstPositional(args) ?? "")
            : undefined
      return [host ?? UNKNOWN_HOST]
    }
    case "ping":
    case "nc":
    case "telnet":
    case "nslookup":
    case "dig": {
      const host = args.map(bareHost).find((h) => h !== undefined)
      return [host ?? UNKNOWN_HOST]
    }
    default:
      return []
  }
}

/** Distinct network targets (hosts or registry labels) a command line would likely contact. */
export function detectNetwork(command: string): string[] {
  const targets = command.split(SEGMENT_SEPARATOR).flatMap(detectSegment)
  return [...new Set(targets)]
}
