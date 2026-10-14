import { ipcMain } from 'electron'
import { simpleGit, type PushResult, type SimpleGit, type StatusResult } from 'simple-git'
import { stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { IPC } from '../../shared/ipc'
import type { GitBranchInfo, GitCommitInfo, GitFileChange, GitStatus, GitStatusCode } from '../../shared/types'
import { assertAbsolutePath, errorMessage, friendlyFsError, trashPath } from './fs'
import { cleanProcessEnv } from './terminal'

const DEFAULT_TIMEOUT_MS = 60_000
const NETWORK_TIMEOUT_MS = 180_000
const COMMIT_TIMEOUT_MS = 10 * 60_000
const COMMIT_DIFF_LIMIT = 60_000
const MAX_STATUS_FILES = 10_000
const MAX_UNTRACKED_IN_COMMIT_DIFF = 25
const PATH_CHUNK = 200
const DIFF_FLAGS = ['--no-color', '--no-ext-diff']

// ─────────────────────────────────────────────────────────────────────────────
// simple-git setup
// ─────────────────────────────────────────────────────────────────────────────

let cachedEnv: Record<string, string> | null = null

/** Environment for git: never prompt on a TTY, English output (parsed by simple-git), literal pathspecs. */
function gitEnv(): Record<string, string> {
  if (cachedEnv) return cachedEnv
  const env = cleanProcessEnv()
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_LITERAL_PATHSPECS = '1'
  env.LC_ALL = 'en_US.UTF-8'
  env.LANG = 'en_US.UTF-8'
  if (process.platform === 'darwin') {
    // GUI apps on macOS get a minimal PATH; hooks (husky, lint-staged…) usually need Homebrew/npm binaries.
    const parts = (env.PATH ?? '').split(delimiter).filter(Boolean)
    for (const extra of ['/opt/homebrew/bin', '/usr/local/bin']) if (!parts.includes(extra)) parts.push(extra)
    env.PATH = parts.join(delimiter)
  }
  cachedEnv = env
  return env
}

function createGit(baseDir: string, timeoutMs = DEFAULT_TIMEOUT_MS): SimpleGit {
  return simpleGit({
    baseDir,
    maxConcurrentProcesses: 6,
    trimmed: false,
    config: ['core.quotepath=false', 'color.ui=false'],
    timeout: { block: timeoutMs },
    // The environment is the user's own (EDITOR, GIT_SSH_COMMAND, askpass helpers…): allow simple-git to pass it on.
    unsafe: {
      allowUnsafeEditor: true,
      allowUnsafePager: true,
      allowUnsafeAskPass: true,
      allowUnsafeSshCommand: true,
      allowUnsafeConfigPaths: true,
      allowUnsafeConfigEnvCount: true,
      allowUnsafeDiffExternal: true,
      allowUnsafeGitProxy: true,
      allowUnsafeTemplateDir: true
    }
  }).env(gitEnv())
}

/** Turn a simple-git / spawn error into a concise message (without "fatal:" noise and hints). */
function friendlyGitError(err: unknown): Error {
  const msg = errorMessage(err)
  if (/spawn\s+(?:\S*[\\/])?git(?:\.exe)?\s+ENOENT/i.test(msg)) {
    return new Error('Git is not installed or not on PATH. Install Git from https://git-scm.com and restart ATOM Code.')
  }
  if (/block timeout reached/i.test(msg)) return new Error('Git did not respond in time and was stopped.')
  const lines = msg
    .split(/\r?\n/)
    .map((l) => l.replace(/^(fatal|error):\s*/i, '').trimEnd())
    .filter((l) => l.trim() !== '' && !/^hint:/i.test(l.trim()))
  return new Error(lines.join('\n').trim() || 'Git command failed')
}

interface Repo {
  git: SimpleGit
  /** Repository top-level, spelled like the workspace path (not symlink-resolved). */
  top: string
}

function isNotRepoError(err: unknown): boolean {
  return /not a git repository|must be run in a work tree/i.test(errorMessage(err))
}

async function assertDirectory(root: string): Promise<void> {
  try {
    const st = await stat(root)
    if (!st.isDirectory()) throw new Error(`Not a directory: ${root}`)
  } catch (err) {
    throw friendlyFsError(err, root, 'Git')
  }
}

/**
 * Locate the repository containing `root`. The top-level is derived from `--show-prefix` so it keeps the
 * caller's spelling of the path (git itself would return a symlink-resolved path, e.g. /private/var on macOS).
 */
async function openRepo(root: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Repo | null> {
  await assertDirectory(root)
  const git = createGit(root, timeoutMs)
  let prefix: string
  try {
    prefix = (await git.raw(['rev-parse', '--show-prefix'])).trim()
  } catch (err) {
    if (isNotRepoError(err)) return null
    throw friendlyGitError(err)
  }
  const depth = prefix ? prefix.replace(/\/+$/, '').split('/').length : 0
  let top = root
  for (let i = 0; i < depth; i++) top = dirname(top)
  return { git: depth === 0 ? git : createGit(top, timeoutMs), top }
}

async function requireRepo(root: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Repo> {
  const repo = await openRepo(root, timeoutMs)
  if (!repo) throw new Error(`Not a git repository: ${root}`)
  return repo
}

/** Absolute or repository-relative path → repository-relative path with forward slashes. */
function toRepoPath(repo: Repo, p: string): string {
  const abs = isAbsolute(p) ? resolve(p) : resolve(repo.top, p)
  const rel = relative(repo.top, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path is outside the repository: ${p}`)
  return rel.split(sep).join('/') || '.'
}

function assertPathList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Expected a list of paths')
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || v.trim() === '' || v.includes('\0')) throw new Error('Invalid path in list')
    out.push(v)
  }
  return out
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function headCommit(repo: Repo): Promise<string | null> {
  try {
    const out = (await repo.git.raw(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim()
    return out || null
  } catch {
    return null
  }
}

/** Which of the given repo-relative paths are untracked (not ignored). */
async function untrackedAmong(repo: Repo, rels: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  for (const chunk of chunks(rels, PATH_CHUNK)) {
    const out = await repo.git.raw(['ls-files', '-z', '--others', '--exclude-standard', '--', ...chunk])
    for (const p of out.split('\0')) if (p) result.add(p)
  }
  return result
}

function validateRefName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`)
  const name = value.trim()
  if (name.startsWith('-') || /[\s~^:?*[\\\0]|\.\.|@\{|\/\/|\.lock$|\/$|^\/|\.$/.test(name)) {
    throw new Error(`Invalid ${label.toLowerCase()}: ${name}`)
  }
  return name
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… (diff truncated)` : text
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CODES = new Set<GitStatusCode>([' ', 'M', 'A', 'D', 'R', 'C', 'U', '?', '!'])

function toStatusCode(c: string): GitStatusCode {
  if (!c) return ' '
  if (STATUS_CODES.has(c as GitStatusCode)) return c as GitStatusCode
  // 'T' (type change) and anything unexpected is shown as a modification.
  return 'M'
}

function isConflict(index: string, wt: string): boolean {
  return index === 'U' || wt === 'U' || (index === 'A' && wt === 'A') || (index === 'D' && wt === 'D')
}

function mapStatusFiles(repo: Repo, s: StatusResult): GitFileChange[] {
  const files: GitFileChange[] = []
  for (const f of s.files.slice(0, MAX_STATUS_FILES)) {
    const index = toStatusCode(f.index)
    const workingTree = toStatusCode(f.working_dir)
    const untracked = index === '?' && workingTree === '?'
    const conflicted = isConflict(f.index, f.working_dir)
    const relPath = f.path.replace(/\\/g, '/').replace(/\/$/, '')
    const change: GitFileChange = {
      path: join(repo.top, ...relPath.split('/')),
      relativePath: relPath,
      index,
      workingTree,
      staged: !untracked && !conflicted && index !== ' ' && index !== '?' && index !== '!',
      untracked,
      conflicted
    }
    if (f.from) change.renamedFrom = f.from.replace(/\\/g, '/')
    files.push(change)
  }
  return files
}

async function getStatus(root: string): Promise<GitStatus> {
  const notRepo: GitStatus = { isRepo: false, root: null, branch: null, tracking: null, ahead: 0, behind: 0, files: [] }
  let repo: Repo | null
  try {
    repo = await openRepo(root)
  } catch (err) {
    // No git binary: behave like "not a repository" so the UI can still render.
    if (/not installed or not on PATH/.test(errorMessage(err))) return notRepo
    throw err
  }
  if (!repo) return notRepo
  const s = await repo.git.status()
  let branch = s.current
  if (s.detached || branch === 'HEAD') {
    const head = await headCommit(repo)
    branch = head ? head.slice(0, 7) : branch
  }
  return {
    isRepo: true,
    root: repo.top,
    branch: branch || null,
    tracking: s.tracking,
    ahead: s.ahead,
    behind: s.behind,
    files: mapStatusFiles(repo, s)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diffs
// ─────────────────────────────────────────────────────────────────────────────

/** Diff of an untracked file against /dev/null (git treats "/dev/null" specially on every platform). */
async function untrackedFileDiff(repo: Repo, rel: string): Promise<string> {
  return repo.git.raw(['diff', ...DIFF_FLAGS, '--no-index', '--', '/dev/null', rel])
}

async function getDiff(root: string, path?: unknown, staged?: unknown): Promise<string> {
  const repo = await requireRepo(root)
  const cached = staged === true ? ['--cached'] : []
  if (typeof path === 'string' && path) {
    const rel = toRepoPath(repo, path)
    if (staged !== true && (await untrackedAmong(repo, [rel])).has(rel)) return untrackedFileDiff(repo, rel)
    return repo.git.raw(['diff', ...DIFF_FLAGS, ...cached, '--', rel])
  }
  return repo.git.raw(['diff', ...DIFF_FLAGS, ...cached])
}

async function fileAtHead(root: string, path: unknown): Promise<string | null> {
  if (typeof path !== 'string' || !path) throw new Error('Path is required')
  const repo = await openRepo(root).catch(() => null)
  if (!repo) return null
  let rel: string
  try {
    rel = toRepoPath(repo, path)
  } catch {
    return null
  }
  try {
    return await repo.git.raw(['show', '--no-textconv', `HEAD:${rel}`])
  } catch {
    return null
  }
}

/**
 * Diff used to generate commit messages: the staged diff, or — when nothing is staged — the working tree diff
 * plus untracked files. Truncated to 60 000 characters (with a --stat summary first when truncated).
 */
export async function getRepoDiffForCommit(root: string): Promise<string> {
  const repo = await requireRepo(assertAbsolutePath(root, 'Repository path'))
  const staged = await repo.git.raw(['diff', ...DIFF_FLAGS, '--cached'])
  if (staged.trim()) return withStatIfTruncated(repo, staged, ['--cached'])

  let working = await repo.git.raw(['diff', ...DIFF_FLAGS])
  const untrackedOut = await repo.git.raw(['ls-files', '-z', '--others', '--exclude-standard'])
  const untracked = untrackedOut.split('\0').filter(Boolean)
  for (const rel of untracked.slice(0, MAX_UNTRACKED_IN_COMMIT_DIFF)) {
    if (working.length > COMMIT_DIFF_LIMIT) break
    try {
      working += await untrackedFileDiff(repo, rel)
    } catch {
      /* unreadable file — skip */
    }
  }
  if (untracked.length > MAX_UNTRACKED_IN_COMMIT_DIFF) {
    working += `\n# …and ${untracked.length - MAX_UNTRACKED_IN_COMMIT_DIFF} more untracked files:\n`
    working += untracked
      .slice(MAX_UNTRACKED_IN_COMMIT_DIFF, MAX_UNTRACKED_IN_COMMIT_DIFF + 200)
      .map((f) => `#   ${f}`)
      .join('\n')
  }
  if (!working.trim()) return ''
  return withStatIfTruncated(repo, working, [])
}

async function withStatIfTruncated(repo: Repo, diff: string, extra: string[]): Promise<string> {
  if (diff.length <= COMMIT_DIFF_LIMIT) return diff
  let summary = ''
  try {
    summary = (await repo.git.raw(['diff', ...DIFF_FLAGS, '--stat=120', ...extra])).slice(0, 6000)
  } catch {
    /* summary is optional */
  }
  const head = summary ? `${summary.trimEnd()}\n\n` : ''
  return truncate(head + diff, COMMIT_DIFF_LIMIT)
}

// ─────────────────────────────────────────────────────────────────────────────
// Index / working tree operations
// ─────────────────────────────────────────────────────────────────────────────

async function stage(root: string, rawPaths: unknown): Promise<void> {
  const paths = assertPathList(rawPaths)
  if (paths.length === 0) return
  const repo = await requireRepo(root)
  const rels = paths.map((p) => toRepoPath(repo, p))
  // -A stages additions, modifications and deletions of exactly these paths.
  for (const chunk of chunks(rels, PATH_CHUNK)) await repo.git.raw(['add', '-A', '--', ...chunk])
}

async function unstage(root: string, rawPaths: unknown): Promise<void> {
  const paths = assertPathList(rawPaths)
  if (paths.length === 0) return
  const repo = await requireRepo(root)
  const rels = new Set(paths.map((p) => toRepoPath(repo, p)))
  // Unstaging a rename must also restore the original path in the index.
  try {
    const s = await repo.git.status()
    for (const f of s.files) if (f.from && rels.has(f.path.replace(/\\/g, '/'))) rels.add(f.from.replace(/\\/g, '/'))
  } catch {
    /* best effort */
  }
  const list = [...rels]
  const hasHead = (await headCommit(repo)) !== null
  for (const chunk of chunks(list, PATH_CHUNK)) {
    if (hasHead) await repo.git.raw(['reset', '-q', 'HEAD', '--', ...chunk])
    else await repo.git.raw(['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...chunk])
  }
}

async function discard(root: string, rawPaths: unknown): Promise<void> {
  const paths = assertPathList(rawPaths)
  if (paths.length === 0) return
  const repo = await requireRepo(root)
  const rels = paths.map((p) => toRepoPath(repo, p))
  if (rels.includes('.')) throw new Error('Refusing to discard the whole repository at once')
  const untracked = await untrackedAmong(repo, rels)
  // Untracked files are moved to the trash so the user can still recover them.
  for (const rel of untracked) await trashPath(join(repo.top, ...rel.split('/')))
  const tracked = rels.filter((r) => !untracked.has(r))
  for (const chunk of chunks(tracked, PATH_CHUNK)) await repo.git.raw(['checkout', '-q', '--', ...chunk])
}

async function commit(root: string, message: unknown, options: unknown): Promise<string> {
  const opts = typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {}
  const amend = opts.amend === true
  const all = opts.all === true
  const msg = typeof message === 'string' ? message.replace(/\r\n/g, '\n').trim() : ''
  if (!msg && !amend) throw new Error('Commit message is empty')

  const repo = await requireRepo(root, COMMIT_TIMEOUT_MS)
  if (all) await repo.git.raw(['add', '-A'])
  const before = await headCommit(repo)
  const args = ['commit']
  if (amend) args.push('--amend')
  if (msg) args.push('-m', msg)
  else args.push('--no-edit')
  // git exits with 1 (and only stdout) when there is nothing to commit — simple-git does not treat that as an error.
  const output = await repo.git.raw(args)
  const after = await headCommit(repo)
  if (!after || (!amend && after === before)) {
    const text = output.trim()
    if (/nothing to commit|no changes added to commit|nothing added to commit/i.test(text)) {
      throw new Error('Nothing to commit — stage some changes first')
    }
    throw new Error(text.split('\n')[0] || 'Commit failed')
  }
  return after
}

// ─────────────────────────────────────────────────────────────────────────────
// Branches & history
// ─────────────────────────────────────────────────────────────────────────────

async function listBranches(root: string): Promise<GitBranchInfo[]> {
  const repo = await requireRepo(root)
  const summary = await repo.git.branch(['-a', '--no-color'])
  const local: GitBranchInfo[] = []
  const remote: GitBranchInfo[] = []
  for (const name of summary.all) {
    if (name.startsWith('(') || name.endsWith('/HEAD')) continue
    const info = summary.branches[name]
    if (name.startsWith('remotes/')) remote.push({ name: name.slice('remotes/'.length), current: false, remote: true })
    else local.push({ name, current: info?.current === true, remote: false })
  }
  // A fresh repository has an (unborn) current branch that `git branch` does not list yet.
  if (local.length === 0) {
    try {
      const unborn = (await repo.git.raw(['symbolic-ref', '--short', '-q', 'HEAD'])).trim()
      if (unborn) local.push({ name: unborn, current: true, remote: false })
    } catch {
      /* detached or unreadable HEAD */
    }
  }
  return [...local, ...remote]
}

async function refExists(repo: Repo, ref: string): Promise<boolean> {
  try {
    // Exits 1 without stderr when missing (simple-git resolves with empty output in that case).
    const out = await repo.git.raw(['rev-parse', '--verify', '--quiet', ref])
    return out.trim() !== ''
  } catch {
    return false
  }
}

async function checkout(root: string, rawBranch: unknown): Promise<void> {
  const branch = validateRefName(rawBranch, 'Branch name')
  const repo = await requireRepo(root)
  if (await refExists(repo, `refs/heads/${branch}`)) {
    await repo.git.raw(['checkout', '-q', branch, '--'])
    return
  }
  if (await refExists(repo, `refs/remotes/${branch}`)) {
    // Picking "origin/feature" checks out (or creates) the local tracking branch "feature".
    const localName = branch.slice(branch.indexOf('/') + 1)
    if (localName && (await refExists(repo, `refs/heads/${localName}`))) {
      await repo.git.raw(['checkout', '-q', localName, '--'])
    } else {
      await repo.git.raw(['checkout', '-q', '--track', branch])
    }
    return
  }
  await repo.git.raw(['checkout', '-q', branch, '--'])
}

async function createBranch(root: string, rawName: unknown): Promise<void> {
  const name = validateRefName(rawName, 'Branch name')
  const repo = await requireRepo(root)
  try {
    await repo.git.raw(['check-ref-format', '--branch', name])
  } catch {
    throw new Error(`Invalid branch name: ${name}`)
  }
  await repo.git.checkoutLocalBranch(name)
}

async function getLog(root: string, rawLimit: unknown): Promise<GitCommitInfo[]> {
  const repo = await openRepo(root)
  if (!repo || (await headCommit(repo)) === null) return []
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 1000) : 50
  const result = await repo.git.log({ maxCount: limit })
  return result.all.map((c) => {
    const body = c.body?.trim() ?? ''
    const date = new Date(c.date)
    return {
      hash: c.hash,
      shortHash: c.hash.slice(0, 7),
      message: body ? `${c.message}\n\n${body}` : c.message,
      author: c.author_name,
      date: Number.isNaN(date.getTime()) ? c.date : date.toISOString()
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Remotes
// ─────────────────────────────────────────────────────────────────────────────

async function pickRemote(repo: Repo): Promise<string> {
  const remotes = (await repo.git.raw(['remote'])).split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
  if (remotes.length === 0) throw new Error('No remote is configured. Add one with "git remote add origin <url>".')
  return remotes.includes('origin') ? 'origin' : remotes[0]
}

async function push(root: string): Promise<string> {
  const repo = await requireRepo(root, NETWORK_TIMEOUT_MS)
  const s = await repo.git.status()
  if (s.detached || !s.current || s.current === 'HEAD') throw new Error('Cannot push a detached HEAD — check out a branch first.')
  let result: PushResult
  let publishedTo: string | null = null
  if (s.tracking) {
    result = await repo.git.push()
  } else {
    const remote = await pickRemote(repo)
    result = await repo.git.push(remote, s.current, ['--set-upstream'])
    publishedTo = `${remote}/${s.current}`
  }
  const shortRef = (ref: string): string => ref.replace(/^refs\/(heads|tags)\//, '')
  const lines: string[] = []
  const pushed = (result.pushed ?? []).filter((p) => !p.alreadyUpdated)
  if (publishedTo) lines.push(`Published ${s.current} to ${publishedTo}`)
  else if (result.update) {
    const { head, hash } = result.update
    lines.push(`Pushed ${shortRef(head.local)} → ${s.tracking ?? shortRef(head.remote)} (${hash.from}..${hash.to})`)
  } else if (pushed.length > 0) lines.push(`Pushed ${pushed.map((p) => `${shortRef(p.local)} → ${shortRef(p.remote)}`).join(', ')}`)
  else lines.push('Everything up-to-date')
  const prUrl = result.remoteMessages?.pullRequestUrl
  if (prUrl) lines.push(`Create a pull request: ${prUrl}`)
  return lines.join('\n')
}

async function pull(root: string): Promise<string> {
  const repo = await requireRepo(root, NETWORK_TIMEOUT_MS)
  const s = await repo.git.status()
  if (s.detached) throw new Error('Cannot pull with a detached HEAD — check out a branch first.')
  if (!s.tracking) throw new Error(`The branch '${s.current ?? 'HEAD'}' has no upstream branch. Push it first to publish it.`)
  const before = await headCommit(repo)
  const result = await repo.git.pull(['--no-edit'])
  const after = await headCommit(repo)
  if (before === after) return 'Already up to date.'
  const { changes, insertions, deletions } = result.summary
  if (changes === 0) return `Updated to ${after ? after.slice(0, 7) : 'latest'}`
  return `${changes} file${changes === 1 ? '' : 's'} changed, ${insertions} insertion${insertions === 1 ? '' : 's'}(+), ${deletions} deletion${deletions === 1 ? '' : 's'}(-)`
}

async function init(root: string): Promise<void> {
  await assertDirectory(root)
  await createGit(root).init()
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────────────────────

/** Register a handler whose first argument is the repository root; errors are made user friendly. */
function handle<T>(channel: string, fn: (root: string, ...args: unknown[]) => Promise<T>): void {
  ipcMain.handle(channel, async (_e, root: unknown, ...args: unknown[]) => {
    try {
      return await fn(assertAbsolutePath(root, 'Repository path'), ...args)
    } catch (err) {
      throw friendlyGitError(err)
    }
  })
}

export function registerGitIpc(): void {
  handle(IPC.gitStatus, (root) => getStatus(root))
  handle(IPC.gitDiff, (root, path, staged) => getDiff(root, path, staged))
  handle(IPC.gitFileAtHead, (root, path) => fileAtHead(root, path))
  handle(IPC.gitStage, (root, paths) => stage(root, paths))
  handle(IPC.gitUnstage, (root, paths) => unstage(root, paths))
  handle(IPC.gitDiscard, (root, paths) => discard(root, paths))
  handle(IPC.gitCommit, (root, message, options) => commit(root, message, options))
  handle(IPC.gitBranches, (root) => listBranches(root))
  handle(IPC.gitCheckout, (root, branch) => checkout(root, branch))
  handle(IPC.gitCreateBranch, (root, name) => createBranch(root, name))
  handle(IPC.gitLog, (root, limit) => getLog(root, limit))
  handle(IPC.gitPush, (root) => push(root))
  handle(IPC.gitPull, (root) => pull(root))
  handle(IPC.gitInit, (root) => init(root))
}
