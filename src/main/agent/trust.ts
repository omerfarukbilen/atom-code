/**
 * Workspace trust — pure helpers (no Electron imports, unit tested).
 *
 * A repository can ship Claude Code project configuration that runs commands as soon as an agent
 * session starts: hooks and `env`/`apiKeyHelper`/`statusLine` in `.claude/settings*.json`, stdio
 * servers in `.mcp.json`, plus instructions in CLAUDE.md / ATOM.md (which may be symlinks to files
 * outside the repository). None of that goes through the permission prompt, so ATOM Code only loads
 * it for folders the user explicitly trusted (`AppSettings.trustedWorkspaces`).
 */
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/** Entries in a workspace root that Claude Code loads as project configuration. */
export const PROJECT_CONFIG_ENTRIES = ['.claude', '.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', 'ATOM.md'] as const

/** Instruction files Claude Code also picks up from every parent folder of the workspace. */
const PARENT_MEMORY_FILES = ['CLAUDE.md', 'CLAUDE.local.md'] as const

/** Absolute path with symlinks resolved when possible (the form stored in `trustedWorkspaces`). */
export function canonicalWorkspacePath(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync.native(abs)
  } catch {
    return abs
  }
}

function comparable(p: string): string {
  const trimmed = p.length > 1 ? p.replace(/[\\/]+$/, '') || p : p
  return CASE_INSENSITIVE ? trimmed.toLowerCase() : trimmed
}

function isSameOrInside(root: string, target: string): boolean {
  if (target === root) return true
  const prefix = root.endsWith(sep) || root.endsWith('/') ? root : root + sep
  return target.startsWith(prefix)
}

/** True when `workspace` (as given or with symlinks resolved) equals or lies inside a trusted folder. */
export function isPathTrusted(trusted: readonly unknown[] | undefined, workspace: string): boolean {
  if (!Array.isArray(trusted) || trusted.length === 0 || !workspace) return false
  const candidates = new Set([comparable(resolve(workspace)), comparable(canonicalWorkspacePath(workspace))])
  for (const entry of trusted) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    const root = comparable(resolve(entry))
    for (const candidate of candidates) if (isSameOrInside(root, candidate)) return true
  }
  return false
}

function exists(p: string): boolean {
  try {
    // lstat: a dangling symlink (e.g. ATOM.md → a file that is not there yet) still counts.
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

/**
 * Project configuration an agent session would load for `workspace`: entries of the workspace root
 * and CLAUDE.md files in its parent folders. Returned as display paths (relative to the workspace
 * when inside it). Empty when there is nothing to trust.
 */
export function findProjectConfig(workspace: string): string[] {
  const root = resolve(workspace)
  const found: string[] = []
  for (const name of PROJECT_CONFIG_ENTRIES) {
    if (exists(join(root, name))) found.push(name === '.claude' ? '.claude/' : name)
  }
  let dir = dirname(root)
  while (dir && dir !== dirname(dir)) {
    for (const name of PARENT_MEMORY_FILES) {
      const file = join(dir, name)
      if (exists(file)) found.push(file)
    }
    dir = dirname(dir)
  }
  return found
}

/**
 * Real path of `file` when it resolves inside `workspace` (symlinks followed on both sides), else null.
 * Used for files read from a workspace on the agent's behalf (ATOM.md), so a link to `~/.ssh/id_rsa`
 * or `/proc/self/environ` never ends up in a prompt.
 */
export function resolveInsideWorkspace(workspace: string, file: string): string | null {
  let realRoot: string
  let realFile: string
  try {
    realRoot = realpathSync.native(resolve(workspace))
    realFile = realpathSync.native(resolve(file))
  } catch {
    return null
  }
  const rel = relative(realRoot, realFile)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return realFile
}
