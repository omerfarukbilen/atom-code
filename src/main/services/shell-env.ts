/**
 * Login-shell PATH for GUI launches.
 *
 * Started from the macOS Dock/Finder (or a Linux desktop launcher), the app inherits the session's
 * minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin` from launchd) instead of the one the user's shell
 * profile builds (Homebrew, nvm, volta, asdf, ~/.local/bin…). Every child process inherits it: MCP
 * stdio servers configured as `npx …`, git hooks (husky, lint-staged), bare shell names in the terminal
 * settings. Before any service starts, ask the user's login shell for its PATH once and adopt it.
 * No runtime Electron imports (unit tested).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, delimiter } from 'node:path'

const START = '__ATOM_PATH_START__'
const END = '__ATOM_PATH_END__'
const DEFAULT_TIMEOUT_MS = 3000
/** Shells that accept `-i -l -c <command>` and run `echo`/external commands the usual way. */
const SUPPORTED_SHELLS = new Set(['bash', 'zsh', 'sh', 'dash', 'ksh', 'mksh', 'fish'])

/** The PATH printed between the markers (rc files may print anything around it), or null. */
export function parseShellPath(output: string): string | null {
  const start = output.lastIndexOf(START)
  if (start === -1) return null
  const end = output.indexOf(END, start + START.length)
  if (end === -1) return null
  const value = output.slice(start + START.length, end).trim()
  return value && !value.includes('\n') ? value : null
}

/** Login-shell entries first (the user's order), then entries only the current PATH has; no duplicates. */
export function mergePaths(loginPath: string, currentPath: string | undefined, sep: string = delimiter): string {
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of [...loginPath.split(sep), ...(currentPath ?? '').split(sep)]) {
    const dir = entry.trim()
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    out.push(dir)
  }
  return out.join(sep)
}

function startedFromTerminal(): boolean {
  try {
    return Boolean(process.stdin?.isTTY || process.stdout?.isTTY)
  } catch {
    return false
  }
}

/** Whether this launch should adopt the login shell's PATH: always on macOS, on Linux when not started from a terminal. */
export function shouldResolveShellPath(platform: NodeJS.Platform = process.platform, fromTerminal?: boolean): boolean {
  if (platform === 'darwin') return true
  if (platform === 'linux') return !(fromTerminal ?? startedFromTerminal())
  return false
}

function loginShell(): string | null {
  const configured = process.env.SHELL
  if (configured && SUPPORTED_SHELLS.has(basename(configured)) && existsSync(configured)) return configured
  for (const candidate of process.platform === 'darwin' ? ['/bin/zsh', '/bin/bash'] : ['/bin/bash', '/bin/sh']) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Run the user's login shell once and return its PATH (null on any failure or after `timeoutMs`). */
export function readLoginShellPath(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | null> {
  const shell = loginShell()
  if (!shell) return Promise.resolve(null)
  return new Promise((resolvePath) => {
    let settled = false
    let output = ''
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !key.toUpperCase().startsWith('ELECTRON_')) env[key] = value
    }
    // Lets rc files skip slow interactive-only setup (cf. VSCODE_RESOLVING_ENVIRONMENT).
    env.ATOM_RESOLVING_ENVIRONMENT = '1'
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Background jobs started by rc files may keep the pipe open: stop listening, never wait for them.
      child.stdout?.destroy()
      child.unref()
      resolvePath(value)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell, ['-i', '-l', '-c', `echo ${START}; /usr/bin/env printenv PATH; echo ${END}`], {
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: true,
        windowsHide: true
      })
    } catch {
      resolvePath(null)
      return
    }
    const timer = setTimeout(() => {
      // rc files can start long-running things (tmux, ssh-agent…): kill the whole process group.
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
      finish(parseShellPath(output))
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
      if (output.length > 256 * 1024) output = output.slice(-64 * 1024)
      // Done as soon as the end marker is in: do not wait for background jobs holding stdout open.
      if (output.includes(END)) finish(parseShellPath(output))
    })
    child.on('error', () => finish(null))
    // 'close' (not 'exit'): stdout may still hold the last chunk when the process exits.
    child.on('close', () => finish(parseShellPath(output)))
  })
}

/**
 * Adopt the login shell's PATH into `process.env` (inherited by every process ATOM Code starts). Must
 * finish before services read PATH (git caches its environment). Never throws.
 */
export async function adoptLoginShellPath(): Promise<void> {
  if (!shouldResolveShellPath()) return
  try {
    const loginPath = await readLoginShellPath()
    if (loginPath) process.env.PATH = mergePaths(loginPath, process.env.PATH)
  } catch {
    /* keep the inherited PATH */
  }
}
