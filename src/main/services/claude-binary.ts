/**
 * Locates the Claude Code executable ATOM Code drives (docs/ARCHITECTURE.md §4).
 *
 * Resolution order:
 *  1. `settings.agent.claudeExecutablePath` when `useBundledClaude` is false and the path exists
 *     (a bare command name such as `claude` is looked up on PATH);
 *  2. the native binary bundled with the Agent SDK
 *     (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]/claude[.exe]`, asar-unpacked);
 *  3. `claude` on PATH (plus the usual install locations GUI-launched apps do not have on PATH).
 */
import { execFile, spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { unpackedPath } from '../context'
import { parseCmdShimTarget } from './cmd-shim'
import { settingsService } from './settings'

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
const VERSION_TIMEOUT_MS = 10_000
const IS_WIN = process.platform === 'win32'

// ─────────────────────────────────────────────────────────────────────────────
// Small fs helpers
// ─────────────────────────────────────────────────────────────────────────────

function fileMtime(p: string): number | null {
  try {
    const st = statSync(p)
    return st.isFile() ? st.mtimeMs : null
  } catch {
    return null
  }
}

function isFile(p: string): boolean {
  return fileMtime(p) !== null
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundled binary (Agent SDK platform packages)
// ─────────────────────────────────────────────────────────────────────────────

let muslCache: boolean | null = null

/** True on musl-based Linux (Alpine…). Mirrors the SDK: no glibc runtime version in the process report. */
function isMuslLibc(): boolean {
  if (process.platform !== 'linux') return false
  if (muslCache !== null) return muslCache
  let musl: boolean | null = null
  try {
    const report: unknown = process.report?.getReport()
    if (typeof report === 'object' && report !== null && 'header' in report) {
      const header: unknown = report.header
      if (typeof header === 'object' && header !== null) musl = !('glibcVersionRuntime' in header) || header.glibcVersionRuntime === undefined
    }
  } catch {
    /* process.report unavailable — fall back to the loader check */
  }
  if (musl === null) {
    try {
      musl = readdirSync('/lib').some((name) => name.startsWith('ld-musl-'))
    } catch {
      musl = false
    }
  }
  muslCache = musl
  return musl
}

/**
 * Module specifiers of the SDK's native binary for a platform, most likely first
 * (e.g. `@anthropic-ai/claude-agent-sdk-linux-x64/claude`, then the `-musl` variant).
 */
export function bundledBinarySpecifiers(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  preferMusl: boolean = isMuslLibc()
): string[] {
  const ext = platform === 'win32' ? '.exe' : ''
  const keys =
    platform === 'linux'
      ? preferMusl
        ? [`linux-${arch}-musl`, `linux-${arch}`]
        : [`linux-${arch}`, `linux-${arch}-musl`]
      : [`${platform}-${arch}`]
  return keys.map((key) => `${SDK_PACKAGE}-${key}/claude${ext}`)
}

function resolveBundledBinary(): string | null {
  const require = createRequire(import.meta.url)
  // Hoisted layouts (npm/yarn) resolve from here; nested layouts (pnpm) resolve next to the SDK package.
  const resolvers: Array<(id: string) => string> = [(id) => require.resolve(id)]
  try {
    const sdkEntry = require.resolve(SDK_PACKAGE)
    const sdkRequire = createRequire(sdkEntry)
    resolvers.push((id) => sdkRequire.resolve(id))
  } catch {
    /* SDK not resolvable from here — the first resolver is all we have */
  }
  for (const specifier of bundledBinarySpecifiers()) {
    for (const resolve of resolvers) {
      try {
        const candidate = unpackedPath(resolve(specifier))
        if (isFile(candidate)) return candidate
      } catch {
        /* package for this platform variant is not installed */
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH lookup
// ─────────────────────────────────────────────────────────────────────────────

/** Install locations that are often missing from PATH when the app is launched from the Dock / Start menu. */
function extraSearchDirs(): string[] {
  const home = homedir()
  if (IS_WIN) {
    const dirs = [join(home, '.local', 'bin'), join(home, '.claude', 'local')]
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'))
    if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, 'Programs', 'claude'))
    return dirs
  }
  return [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ]
}

/** Resolve a command name against PATH (+ PATHEXT on Windows, preferring .exe). Returns null when not found. */
function findOnPath(name: string): string | null {
  if (name.includes('/') || name.includes('\\')) return null
  const pathVar = process.env.PATH ?? process.env.Path ?? ''
  const dirs = [...pathVar.split(delimiter).filter(Boolean), ...extraSearchDirs()]
  const exts = IS_WIN
    ? ['.exe', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()).filter((e) => e && e !== '.exe')]
    : ['']
  const hasExt = IS_WIN && /\.[a-z0-9]+$/i.test(name)
  for (const ext of hasExt ? [''] : exts) {
    for (const dir of dirs) {
      const candidate = join(dir, name + ext)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// npm shims (Windows)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The script or executable an npm `.cmd` shim launches, e.g. `%APPDATA%\npm\claude.cmd` →
 * `…\node_modules\@anthropic-ai\claude-code\cli.js` (or a native `claude.exe`). The Agent SDK spawns
 * the executable without a shell, which Node refuses for `.cmd`/`.bat` files, so ATOM Code drives the
 * shim's target instead. Null when the file is not a recognizable npm shim or the target is missing.
 */
export function resolveCmdShimTarget(shimPath: string): string | null {
  let text: string
  try {
    if (statSync(shimPath).size > 64 * 1024) return null
    text = readFileSync(shimPath, 'utf8')
  } catch {
    return null
  }
  const target = parseCmdShimTarget(text)
  if (!target) return null
  const resolved = join(dirname(shimPath), ...target.split(/[\\/]+/))
  return isFile(resolved) ? resolved : null
}

function preferShimTarget(bin: string | null): string | null {
  if (!bin || !IS_WIN || !/\.(?:cmd|bat)$/i.test(bin)) return bin
  return resolveCmdShimTarget(bin) ?? bin
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

function resolveCustomBinary(raw: string): string | null {
  const value = raw.trim().replace(/^["']|["']$/g, '')
  if (!value) return null
  const expanded = expandHome(value)
  if (isAbsolute(expanded)) return isFile(expanded) ? preferShimTarget(expanded) : null
  return preferShimTarget(findOnPath(expanded))
}

/**
 * Absolute path of the Claude Code executable to drive, or null when none can be found.
 * Cheap enough to call before every query (a few `stat` calls).
 */
export function resolveClaudeBinary(): string | null {
  const agent = settingsService.get().agent
  if (!agent.useBundledClaude) {
    const custom = resolveCustomBinary(agent.claudeExecutablePath ?? '')
    if (custom) return custom
  }
  return resolveBundledBinary() ?? preferShimTarget(findOnPath('claude'))
}

/** How to launch a Claude Code executable with Node's child_process APIs on the current platform. */
export interface ClaudeCommand {
  file: string
  args: string[]
  /** True for Windows `.cmd`/`.bat` shims, which must run through the shell (`file` is pre-quoted). */
  shell: boolean
  env: Record<string, string>
}

/**
 * Build the spawn parameters for `<bin> ...args`:
 * - `.js`/`.mjs`/`.cjs` entry points run with Electron's bundled Node (`ELECTRON_RUN_AS_NODE=1`);
 * - Windows `.cmd`/`.bat` shims need `shell: true` (Node refuses to spawn them directly);
 * - native binaries are spawned as-is.
 */
export function buildClaudeCommand(bin: string, args: string[], env: Record<string, string>): ClaudeCommand {
  if (/\.(?:c|m)?js$/i.test(bin)) {
    return { file: process.execPath, args: [bin, ...args], shell: false, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
  }
  if (IS_WIN && /\.(?:cmd|bat)$/i.test(bin)) {
    return { file: `"${bin}"`, args, shell: true, env }
  }
  return { file: bin, args, shell: false, env }
}

/** Quote one argument for a `cmd.exe /d /s /c "…"` command line that runs a batch file. */
function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`
}

/**
 * A `spawnClaudeCodeProcess` implementation for executables the Agent SDK cannot start itself, or
 * undefined for native binaries (the SDK's default spawn handles those):
 * - `.js`/`.mjs`/`.cjs` entry points: the SDK would run `node <script>` from PATH (missing for apps
 *   launched from the Dock, or a different Node); they run with Electron's bundled Node instead;
 * - Windows `.cmd`/`.bat` files that are not resolvable npm shims: through `cmd.exe` (best effort).
 * The SDK does not read stderr from a custom process, so it is forwarded to `onStderr` here.
 */
export function createClaudeSpawner(
  bin: string | null | undefined,
  onStderr?: (data: string) => void
): ((options: SpawnOptions) => SpawnedProcess) | undefined {
  if (!bin) return undefined
  const isScript = /\.(?:c|m)?js$/i.test(bin)
  const isBatch = IS_WIN && /\.(?:cmd|bat)$/i.test(bin)
  if (!isScript && !isBatch) return undefined
  return (options) => {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(options.env)) if (value !== undefined) env[key] = value
    let child
    if (isScript) {
      // For scripts the SDK passes `<runtime> [...runtimeArgs] <script> ...cliArgs`; keep everything after the runtime.
      const args = options.args.includes(bin) ? options.args : [bin, ...options.args]
      child = spawn(process.execPath, args, {
        cwd: options.cwd,
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: options.signal,
        windowsHide: true
      })
    } else {
      const line = [quoteForCmd(bin), ...options.args.map(quoteForCmd)].join(' ')
      child = spawn(line, [], {
        cwd: options.cwd,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: options.signal,
        windowsHide: true
      })
    }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (data: string) => onStderr?.(data))
    // An abort after exit (or a spawn failure) is reported through 'error'; never let it go unhandled.
    child.on('error', () => undefined)
    return child
  }
}

/** Extract "2.1.299" from `claude --version` output such as "2.1.299 (Claude Code)". */
export function parseClaudeVersion(output: string): string | undefined {
  const match = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(output)
  return match?.[1]
}

const versionCache = new Map<string, { mtimeMs: number; version: Promise<string | undefined> }>()

/** `<bin> --version`, cached per executable (and invalidated when the file changes). Never rejects. */
export function getClaudeVersion(bin: string): Promise<string | undefined> {
  const mtimeMs = fileMtime(bin)
  if (mtimeMs === null) return Promise.resolve(undefined)
  const hit = versionCache.get(bin)
  if (hit && hit.mtimeMs === mtimeMs) return hit.version

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  const cmd = buildClaudeCommand(bin, ['--version'], env)
  const version = new Promise<string | undefined>((resolve) => {
    execFile(
      cmd.file,
      cmd.args,
      { env: cmd.env, shell: cmd.shell, timeout: VERSION_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        const parsed = parseClaudeVersion(String(stdout ?? ''))
        if (err && !parsed) {
          // Do not cache failures: the next call retries (e.g. after the binary was fixed).
          versionCache.delete(bin)
          resolve(undefined)
          return
        }
        resolve(parsed)
      }
    )
  })
  versionCache.set(bin, { mtimeMs, version })
  return version
}
