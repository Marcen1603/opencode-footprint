import { describe, expect, test } from "bun:test"
import { detectNetwork, redactCommand } from "../src/network.js"

describe("detectNetwork", () => {
  test("finds the host of curl and wget URLs", () => {
    expect(detectNetwork("curl -sS https://api.example.com/v1/items?x=1")).toEqual([
      "api.example.com",
    ])
    expect(detectNetwork("wget http://files.example.org/a.tar.gz -O a.tar.gz")).toEqual([
      "files.example.org",
    ])
  })

  test("handles git remote operations", () => {
    expect(detectNetwork("git clone https://github.com/a/b.git")).toEqual(["github.com"])
    expect(detectNetwork("git clone git@github.com:a/b.git")).toEqual(["github.com"])
    expect(detectNetwork("git push")).toEqual(["git remote"])
    expect(detectNetwork("git status")).toEqual([])
    expect(detectNetwork("git commit -m 'curl https://example.com'")).toEqual([])
  })

  test("recognizes package manager installs but not local scripts", () => {
    expect(detectNetwork("npm install left-pad")).toEqual(["npm registry"])
    expect(detectNetwork("bun add zod")).toEqual(["npm registry"])
    expect(detectNetwork("npm run build")).toEqual([])
    expect(detectNetwork("bun test")).toEqual([])
    expect(detectNetwork("python -m pip install requests")).toEqual(["PyPI"])
    expect(detectNetwork("cargo build")).toEqual([])
  })

  test("looks at every command in a pipeline and removes duplicates", () => {
    expect(
      detectNetwork(
        "curl https://a.example.com | sh && curl https://a.example.com && wget https://b.example.com",
      ),
    ).toEqual(["a.example.com", "b.example.com"])
  })

  test("skips wrappers and environment assignments", () => {
    expect(detectNetwork("sudo FOO=1 curl https://example.com")).toEqual(["example.com"])
  })

  test("reports ssh and scp hosts", () => {
    expect(detectNetwork("ssh deploy@server.example.com ls")).toEqual(["server.example.com"])
    expect(detectNetwork("scp file.txt user@host.example.net:/tmp/")).toEqual(["host.example.net"])
  })

  test("ignores commands without network access", () => {
    expect(detectNetwork("ls -la && echo hello")).toEqual([])
    expect(detectNetwork("")).toEqual([])
  })
})

describe("redactCommand", () => {
  test("hides credentials", () => {
    expect(redactCommand("git clone https://user:secret@github.com/a/b.git")).toBe(
      "git clone https://***@github.com/a/b.git",
    )
    expect(redactCommand('curl -H "Authorization: Bearer abc123" https://x.io')).toContain(
      "Bearer ***",
    )
    expect(redactCommand("tool --token abc123 run")).toBe("tool --token *** run")
  })

  test("leaves harmless commands untouched", () => {
    expect(redactCommand("ls -la")).toBe("ls -la")
  })
})
