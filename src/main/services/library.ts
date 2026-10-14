import { ipcMain, shell } from 'electron'
import type { Dirent } from 'node:fs'
import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { IPC } from '../../shared/ipc'
import type {
  CommandInfo,
  LibraryIndex,
  LibraryKind,
  LibraryScope,
  SkillInfo,
  SubagentInfo
} from '../../shared/types'
import { ctx } from '../context'
import { parseFrontmatter, type FrontmatterValue } from './frontmatter'
import { assertAbsolutePath, friendlyFsError, isPathInside, pathExists, trashPath } from './fs'
import { settingsService } from './settings'
import { getCurrentWorkspace } from './workspace'

/** Markdown files larger than this are listed without parsing their frontmatter. */
const MAX_PARSE_BYTES = 1024 * 1024
const MAX_READ_BYTES = 2 * 1024 * 1024
const MAX_SAVE_BYTES = 1024 * 1024
const MAX_SKILL_FILES = 200
const MAX_COMMAND_DEPTH = 5
const KIND_DIRS: Record<LibraryKind, string> = { skill: 'skills', agent: 'agents', command: 'commands' }
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const SKIPPED_DIRS = new Set(['node_modules', '__pycache__', '.git'])

// ─────────────────────────────────────────────────────────────────────────────
// Scope locations
// ─────────────────────────────────────────────────────────────────────────────

/** `~/.claude`, honouring CLAUDE_CONFIG_DIR like Claude Code does. */
export function userClaudeDir(): string {
  const custom = process.env.CLAUDE_CONFIG_DIR?.trim()
  return custom ? resolve(custom) : join(homedir(), '.claude')
}

function projectClaudeDir(workspace: string): string {
  return join(workspace, '.claude')
}

interface ScopeSource {
  scope: LibraryScope
  base: string
}

function samePath(a: string, b: string): boolean {
  const ci = process.platform === 'win32' || process.platform === 'darwin'
  return ci ? a.toLowerCase() === b.toLowerCase() : a === b
}

function scopeSources(workspace: string | null): ScopeSource[] {
  const user = userClaudeDir()
  const sources: ScopeSource[] = [
    { scope: 'atom', base: ctx.pluginDir },
    { scope: 'user', base: user }
  ]
  // Opening the home folder as a workspace would list user items twice.
  if (workspace && !samePath(projectClaudeDir(workspace), user)) sources.push({ scope: 'project', base: projectClaudeDir(workspace) })
  return sources
}

function normalizeWorkspace(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return assertAbsolutePath(value, 'Workspace path')
}

async function requireWorkspaceDir(value: unknown): Promise<string> {
  const ws = normalizeWorkspace(value)
  if (!ws) throw new Error('Open a folder to use project-scoped skills, subagents and commands')
  try {
    if (!(await stat(ws)).isDirectory()) throw new Error(`Not a folder: ${ws}`)
  } catch (err) {
    throw friendlyFsError(err, ws, 'Opening workspace')
  }
  return ws
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────────────────────────────────────

async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

interface MarkdownDoc {
  data: Record<string, FrontmatterValue>
  body: string
}

/** Read and parse a markdown file; null when it does not exist or is unreadable. */
async function readMarkdown(path: string): Promise<MarkdownDoc | null> {
  try {
    const st = await stat(path)
    if (!st.isFile()) return null
    if (st.size > MAX_PARSE_BYTES) return { data: {}, body: '' }
    return parseFrontmatter(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function str(value: FrontmatterValue | undefined): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value.trim()
}

/** `tools: Read, Grep` or `tools: [Read, Grep]` or a block list → string[]. */
function strList(value: FrontmatterValue | undefined): string[] | undefined {
  if (value === undefined || typeof value === 'boolean') return undefined
  const items = (Array.isArray(value) ? value : value.split(',')).map((s) => s.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

/** First meaningful line of a markdown body (used when a command has no description). */
function firstLine(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^#+\s*/, '').trim()
    if (line) return line.length > 200 ? `${line.slice(0, 199)}…` : line
  }
  return ''
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
}

function nonNull<T>(v: T | null): v is T {
  return v !== null
}

function qualify(scope: LibraryScope, name: string): string {
  return scope === 'atom' ? `atom:${name}` : name
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexing
// ─────────────────────────────────────────────────────────────────────────────

/** Files bundled next to SKILL.md (relative, forward slashes, depth ≤ 2, no dotfiles). */
async function listSkillFiles(skillDir: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    const entries = (await safeReaddir(dir)).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (files.length >= MAX_SKILL_FILES) return
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(dir, entry.name)
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(full)))
      if (isDir) {
        if (depth < 2) await walk(full, rel, depth + 1)
      } else if (!(depth === 1 && entry.name === 'SKILL.md')) {
        files.push(rel)
      }
    }
  }
  await walk(skillDir, '', 1)
  return files
}

async function indexSkills(src: ScopeSource, disabled: Set<string>): Promise<SkillInfo[]> {
  const root = join(src.base, 'skills')
  const entries = await safeReaddir(root)
  const skills = await Promise.all(
    entries.map(async (entry): Promise<SkillInfo | null> => {
      if (entry.name.startsWith('.')) return null
      const dir = join(root, entry.name)
      if (!(entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(dir))))) return null
      const path = join(dir, 'SKILL.md')
      const doc = await readMarkdown(path)
      if (!doc) return null
      const declared = str(doc.data.name)
      const name = SKILL_NAME_RE.test(declared) ? declared : entry.name
      const qualifiedName = qualify(src.scope, name)
      return {
        name,
        qualifiedName,
        description: str(doc.data.description) || firstLine(doc.body),
        scope: src.scope,
        path,
        dir,
        files: await listSkillFiles(dir),
        enabled: !disabled.has(qualifiedName),
        readOnly: src.scope === 'atom'
      }
    })
  )
  return skills.filter(nonNull).sort(byName)
}

async function indexAgents(src: ScopeSource): Promise<SubagentInfo[]> {
  const root = join(src.base, 'agents')
  const entries = await safeReaddir(root)
  const agents = await Promise.all(
    entries.map(async (entry): Promise<SubagentInfo | null> => {
      if (entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith('.md')) return null
      const path = join(root, entry.name)
      if (!(await isFile(path))) return null
      const doc = await readMarkdown(path)
      if (!doc) return null
      const declared = str(doc.data.name)
      const name = SKILL_NAME_RE.test(declared) ? declared : entry.name.replace(/\.md$/i, '')
      const model = str(doc.data.model)
      return {
        name,
        qualifiedName: qualify(src.scope, name),
        description: str(doc.data.description) || firstLine(doc.body),
        scope: src.scope,
        path,
        model: model || undefined,
        tools: strList(doc.data.tools),
        readOnly: src.scope === 'atom'
      }
    })
  )
  return agents.filter(nonNull).sort(byName)
}

async function indexCommands(src: ScopeSource): Promise<CommandInfo[]> {
  const root = join(src.base, 'commands')
  const found: { path: string; segments: string[] }[] = []
  const walk = async (dir: string, segments: string[]): Promise<void> => {
    if (segments.length > MAX_COMMAND_DEPTH) return
    for (const entry of await safeReaddir(dir)) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(full)))
      if (isDir) await walk(full, [...segments, entry.name])
      else if (entry.name.toLowerCase().endsWith('.md')) found.push({ path: full, segments: [...segments, entry.name.replace(/\.md$/i, '')] })
    }
  }
  await walk(root, [])
  const commands = await Promise.all(
    found.map(async ({ path, segments }): Promise<CommandInfo | null> => {
      const doc = await readMarkdown(path)
      if (!doc) return null
      const name = segments.join(':')
      // `argument-hint: [message]` parses as a YAML list — show it the way it was written.
      const rawHint = doc.data['argument-hint']
      const hint = Array.isArray(rawHint) ? `[${rawHint.join(', ')}]` : str(rawHint)
      return {
        name,
        qualifiedName: qualify(src.scope, name),
        description: str(doc.data.description) || firstLine(doc.body),
        argumentHint: hint || undefined,
        scope: src.scope,
        path,
        readOnly: src.scope === 'atom'
      }
    })
  )
  return commands.filter(nonNull).sort(byName)
}

/** Index skills, subagents and slash commands from the bundled plugin, ~/.claude and <workspace>/.claude. */
export async function listLibrary(workspace?: string | null): Promise<LibraryIndex> {
  const sources = scopeSources(normalizeWorkspace(workspace))
  const disabled = new Set(settingsService.get().agent.disabledSkills)
  const [skills, agents, commands] = await Promise.all([
    Promise.all(sources.map((s) => indexSkills(s, disabled))),
    Promise.all(sources.map((s) => indexAgents(s))),
    Promise.all(sources.map((s) => indexCommands(s)))
  ])
  return { skills: skills.flat(), agents: agents.flat(), commands: commands.flat(), pluginDir: ctx.pluginDir }
}

/**
 * Value for the SDK `skills` option: `'all'` when no indexed skill is disabled, otherwise the explicit list of
 * enabled qualified names (bundled skills as `atom:<name>`).
 */
export async function getEnabledSkillsOption(workspace: string): Promise<string[] | 'all'> {
  if (settingsService.get().agent.disabledSkills.length === 0) return 'all'
  let index: LibraryIndex
  try {
    index = await listLibrary(workspace || null)
  } catch {
    index = await listLibrary(null)
  }
  if (!index.skills.some((s) => !s.enabled)) return 'all'
  return [...new Set(index.skills.filter((s) => s.enabled).map((s) => s.qualifiedName))]
}

// ─────────────────────────────────────────────────────────────────────────────
// Read / save / delete / open folder
// ─────────────────────────────────────────────────────────────────────────────

async function readItem(raw: unknown): Promise<string> {
  const path = assertAbsolutePath(raw)
  try {
    const st = await stat(path)
    if (!st.isFile()) throw new Error(`Not a file: ${path}`)
    if (st.size > MAX_READ_BYTES) throw new Error(`File is too large to open here (${Math.round(st.size / 1024)} KB): ${path}`)
    return await readFile(path, 'utf8')
  } catch (err) {
    throw friendlyFsError(err, path, 'Reading')
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isKind(v: unknown): v is LibraryKind {
  return v === 'skill' || v === 'agent' || v === 'command'
}

function targetPath(base: string, kind: LibraryKind, name: string): string {
  if (kind === 'skill') return join(base, 'skills', name, 'SKILL.md')
  return join(base, KIND_DIRS[kind], `${name}.md`)
}

async function saveItem(raw: unknown): Promise<string> {
  if (!isRecord(raw)) throw new Error('Invalid save request')
  const { kind, scope, content } = raw
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!isKind(kind)) throw new Error('Kind must be "skill", "agent" or "command"')
  if (scope === 'atom') throw new Error('Bundled ATOM items are read-only — save to the user or project library instead')
  if (scope !== 'user' && scope !== 'project') throw new Error('Scope must be "user" or "project"')
  if (!KEBAB_RE.test(name) || name.length > 64) {
    throw new Error('Name must be kebab-case: lowercase letters, digits and single hyphens (e.g. "my-skill")')
  }
  if (typeof content !== 'string') throw new Error('Content must be a string')
  if (Buffer.byteLength(content, 'utf8') > MAX_SAVE_BYTES) throw new Error('Content is too large (max 1 MB)')

  const base = scope === 'user' ? userClaudeDir() : projectClaudeDir(await requireWorkspaceDir(raw.workspace))
  const path = targetPath(base, kind, name)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  } catch (err) {
    throw friendlyFsError(err, path, 'Saving')
  }
  return path
}

/** Find the `<base>/{skills,agents,commands}` folder that contains `p` (base = ~/.claude or any `.claude`). */
function findKindDir(p: string): { kindDir: string; kind: LibraryKind } | null {
  const user = userClaudeDir()
  let child = p
  let dir = dirname(p)
  while (dir !== child) {
    const name = basename(dir)
    const parent = dirname(dir)
    const kind = (Object.keys(KIND_DIRS) as LibraryKind[]).find((k) => KIND_DIRS[k] === name)
    if (kind && (samePath(parent, user) || basename(parent) === '.claude')) return { kindDir: dir, kind }
    child = dir
    dir = dirname(dir)
  }
  return null
}

async function deleteItem(raw: unknown): Promise<void> {
  const p = assertAbsolutePath(raw)
  if (isPathInside(ctx.pluginDir, p)) {
    throw new Error('Bundled ATOM items are read-only. Duplicate it to your user library to customize it.')
  }
  const located = findKindDir(p)
  if (!located) throw new Error(`Not a skill, subagent or command in a library folder: ${p}`)
  let target = p
  if (located.kind === 'skill') {
    // Deleting SKILL.md (or the skill folder) removes the whole skill; other files are removed individually.
    const parts = relative(located.kindDir, p).split(sep)
    const skillDir = join(located.kindDir, parts[0])
    if (parts.length === 1 || (parts.length === 2 && parts[1] === 'SKILL.md')) target = skillDir
  }
  try {
    await lstat(target)
  } catch (err) {
    throw friendlyFsError(err, target, 'Delete')
  }
  await trashPath(target)
}

async function openFolder(scope: unknown, workspace: unknown): Promise<void> {
  let dir: string
  if (scope === 'atom') {
    dir = ctx.pluginDir
    if (!(await pathExists(dir))) throw new Error(`Bundled plugin folder not found: ${dir}`)
  } else if (scope === 'user' || scope === 'project') {
    dir = scope === 'user' ? userClaudeDir() : projectClaudeDir(await requireWorkspaceDir(workspace ?? getCurrentWorkspace()?.path))
    try {
      await mkdir(dir, { recursive: true })
    } catch (err) {
      throw friendlyFsError(err, dir, 'Creating folder')
    }
  } else {
    throw new Error('Scope must be "atom", "user" or "project"')
  }
  const error = await shell.openPath(dir)
  if (error) throw new Error(`Could not open ${dir}: ${error}`)
}

export function registerLibraryIpc(): void {
  ipcMain.handle(IPC.libraryList, (_e, workspace: unknown) => listLibrary(normalizeWorkspace(workspace)))
  ipcMain.handle(IPC.libraryRead, (_e, path: unknown) => readItem(path))
  ipcMain.handle(IPC.librarySave, (_e, request: unknown) => saveItem(request))
  ipcMain.handle(IPC.libraryDelete, (_e, path: unknown) => deleteItem(path))
  ipcMain.handle(IPC.libraryOpenFolder, (_e, scope: unknown, workspace: unknown) => openFolder(scope, workspace))
}
