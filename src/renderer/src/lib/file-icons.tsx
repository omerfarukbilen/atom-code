import {
  BookOpen,
  Braces,
  Container,
  Database,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileKey,
  FileLock,
  FileMusic,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideoCamera,
  Folder,
  FolderCode,
  FolderCog,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Hammer,
  Hash,
  Package,
  Scale,
  Sparkles,
  type LucideIcon
} from 'lucide-react'
import { cn } from './cn'

/**
 * File-type icons for the explorer, tabs, quick open and search results: lucide glyphs tinted with theme
 * token colors (never hard-coded hex), keyed by exact file name first, then by extension.
 */
export interface FileIconSpec {
  icon: LucideIcon
  /** Tailwind text color class (theme token). */
  className: string
}

const spec = (icon: LucideIcon, className: string): FileIconSpec => ({ icon, className })

const CODE_TS = spec(FileCode, 'text-info')
const CODE_JS = spec(FileCode, 'text-warning')
const JSON_ICON = spec(Braces, 'text-warning')
const STYLE = spec(Hash, 'text-accent')
const MARKUP = spec(FileCode, 'text-danger')
const CONFIG = spec(FileCog, 'text-muted')
const IMAGE = spec(FileImage, 'text-accent-2')
const SHELL = spec(FileTerminal, 'text-success')
const TEXT = spec(FileText, 'text-muted')
const ARCHIVE = spec(FileArchive, 'text-warning')
const LOCK = spec(FileLock, 'text-subtle')

const BY_NAME: Record<string, FileIconSpec> = {
  'package.json': spec(Package, 'text-success'),
  'package-lock.json': LOCK,
  'yarn.lock': LOCK,
  'pnpm-lock.yaml': LOCK,
  'bun.lockb': LOCK,
  'cargo.lock': LOCK,
  'poetry.lock': LOCK,
  'gemfile.lock': LOCK,
  'composer.lock': LOCK,
  'cargo.toml': spec(Package, 'text-warning'),
  'go.mod': spec(Package, 'text-accent-2'),
  'go.sum': LOCK,
  'requirements.txt': spec(Package, 'text-info'),
  'pyproject.toml': spec(Package, 'text-info'),
  'tsconfig.json': spec(FileCog, 'text-info'),
  'jsconfig.json': spec(FileCog, 'text-warning'),
  '.gitignore': spec(GitBranch, 'text-danger'),
  '.gitattributes': spec(GitBranch, 'text-danger'),
  '.gitmodules': spec(GitBranch, 'text-danger'),
  '.gitkeep': spec(GitBranch, 'text-subtle'),
  dockerfile: spec(Container, 'text-info'),
  '.dockerignore': spec(Container, 'text-subtle'),
  'docker-compose.yml': spec(Container, 'text-info'),
  'docker-compose.yaml': spec(Container, 'text-info'),
  'compose.yml': spec(Container, 'text-info'),
  makefile: spec(Hammer, 'text-warning'),
  license: spec(Scale, 'text-warning'),
  'license.md': spec(Scale, 'text-warning'),
  'license.txt': spec(Scale, 'text-warning'),
  'readme.md': spec(BookOpen, 'text-info'),
  readme: spec(BookOpen, 'text-info'),
  'changelog.md': spec(BookOpen, 'text-accent-2'),
  'atom.md': spec(Sparkles, 'text-accent'),
  'claude.md': spec(Sparkles, 'text-accent'),
  'agents.md': spec(Sparkles, 'text-accent'),
  'skill.md': spec(Sparkles, 'text-accent-2'),
  '.editorconfig': CONFIG,
  '.prettierrc': CONFIG,
  '.eslintrc': CONFIG,
  '.npmrc': CONFIG,
  '.nvmrc': CONFIG
}

const BY_EXT: Record<string, FileIconSpec> = {
  ts: CODE_TS,
  tsx: CODE_TS,
  mts: CODE_TS,
  cts: CODE_TS,
  js: CODE_JS,
  jsx: CODE_JS,
  mjs: CODE_JS,
  cjs: CODE_JS,
  json: JSON_ICON,
  jsonc: JSON_ICON,
  json5: JSON_ICON,
  md: spec(FileText, 'text-info'),
  mdx: spec(FileText, 'text-info'),
  css: STYLE,
  scss: spec(Hash, 'text-danger'),
  sass: spec(Hash, 'text-danger'),
  less: spec(Hash, 'text-info'),
  html: MARKUP,
  htm: MARKUP,
  xml: spec(FileCode, 'text-warning'),
  vue: spec(FileCode, 'text-success'),
  svelte: spec(FileCode, 'text-danger'),
  astro: spec(FileCode, 'text-accent'),
  py: spec(FileCode, 'text-info'),
  pyi: spec(FileCode, 'text-info'),
  ipynb: spec(FileCode, 'text-warning'),
  rb: spec(FileCode, 'text-danger'),
  go: spec(FileCode, 'text-accent-2'),
  rs: spec(FileCode, 'text-warning'),
  java: spec(FileCode, 'text-danger'),
  kt: spec(FileCode, 'text-accent'),
  kts: spec(FileCode, 'text-accent'),
  scala: spec(FileCode, 'text-danger'),
  swift: spec(FileCode, 'text-warning'),
  c: spec(FileCode, 'text-info'),
  h: spec(FileCode, 'text-accent'),
  cc: spec(FileCode, 'text-info'),
  cpp: spec(FileCode, 'text-info'),
  hpp: spec(FileCode, 'text-accent'),
  cs: spec(FileCode, 'text-success'),
  php: spec(FileCode, 'text-accent'),
  dart: spec(FileCode, 'text-accent-2'),
  lua: spec(FileCode, 'text-info'),
  r: spec(FileCode, 'text-info'),
  ex: spec(FileCode, 'text-accent'),
  exs: spec(FileCode, 'text-accent'),
  hs: spec(FileCode, 'text-accent'),
  clj: spec(FileCode, 'text-success'),
  zig: spec(FileCode, 'text-warning'),
  sol: spec(FileCode, 'text-muted'),
  graphql: spec(FileCode, 'text-danger'),
  gql: spec(FileCode, 'text-danger'),
  proto: spec(FileCode, 'text-accent-2'),
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  fish: SHELL,
  ps1: spec(FileTerminal, 'text-info'),
  bat: spec(FileTerminal, 'text-muted'),
  cmd: spec(FileTerminal, 'text-muted'),
  yml: spec(FileCog, 'text-danger'),
  yaml: spec(FileCog, 'text-danger'),
  toml: CONFIG,
  ini: CONFIG,
  conf: CONFIG,
  cfg: CONFIG,
  env: spec(FileKey, 'text-warning'),
  pem: spec(FileKey, 'text-success'),
  key: spec(FileKey, 'text-success'),
  crt: spec(FileKey, 'text-success'),
  lock: LOCK,
  sql: spec(Database, 'text-warning'),
  db: spec(Database, 'text-muted'),
  sqlite: spec(Database, 'text-muted'),
  prisma: spec(Database, 'text-accent-2'),
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  gif: IMAGE,
  webp: IMAGE,
  bmp: IMAGE,
  ico: IMAGE,
  avif: IMAGE,
  svg: spec(FileImage, 'text-warning'),
  mp4: spec(FileVideoCamera, 'text-danger'),
  mov: spec(FileVideoCamera, 'text-danger'),
  webm: spec(FileVideoCamera, 'text-danger'),
  mp3: spec(FileMusic, 'text-accent'),
  wav: spec(FileMusic, 'text-accent'),
  ogg: spec(FileMusic, 'text-accent'),
  flac: spec(FileMusic, 'text-accent'),
  ttf: spec(FileType, 'text-muted'),
  otf: spec(FileType, 'text-muted'),
  woff: spec(FileType, 'text-muted'),
  woff2: spec(FileType, 'text-muted'),
  zip: ARCHIVE,
  tar: ARCHIVE,
  gz: ARCHIVE,
  tgz: ARCHIVE,
  rar: ARCHIVE,
  '7z': ARCHIVE,
  csv: spec(FileSpreadsheet, 'text-success'),
  tsv: spec(FileSpreadsheet, 'text-success'),
  xlsx: spec(FileSpreadsheet, 'text-success'),
  xls: spec(FileSpreadsheet, 'text-success'),
  pdf: spec(FileText, 'text-danger'),
  txt: TEXT,
  log: spec(FileText, 'text-subtle'),
  diff: spec(FileCode, 'text-success'),
  patch: spec(FileCode, 'text-success')
}

const DEFAULT_FILE = spec(File, 'text-subtle')

interface FolderSpec {
  closed: LucideIcon
  open: LucideIcon
  className: string
}

const FOLDER_DEFAULT: FolderSpec = { closed: Folder, open: FolderOpen, className: 'text-muted' }
const FOLDER_BY_NAME: Record<string, FolderSpec> = {
  '.git': { closed: FolderGit2, open: FolderGit2, className: 'text-danger' },
  '.github': { closed: FolderGit2, open: FolderGit2, className: 'text-info' },
  '.claude': { closed: FolderCog, open: FolderCog, className: 'text-accent' },
  '.vscode': { closed: FolderCog, open: FolderCog, className: 'text-info' },
  '.cursor': { closed: FolderCog, open: FolderCog, className: 'text-accent' },
  node_modules: { closed: FolderCog, open: FolderCog, className: 'text-subtle' },
  src: { closed: FolderCode, open: FolderCode, className: 'text-accent' },
  lib: { closed: FolderCode, open: FolderCode, className: 'text-accent-2' },
  app: { closed: FolderCode, open: FolderCode, className: 'text-accent' }
}

/** Icon for a file name (basename or path). */
export function getFileIcon(nameOrPath: string): FileIconSpec {
  const name = nameOrPath.slice(Math.max(nameOrPath.lastIndexOf('/'), nameOrPath.lastIndexOf('\\')) + 1).toLowerCase()
  const byName = BY_NAME[name]
  if (byName) return byName
  if (name.startsWith('.env')) return BY_EXT.env
  if (name.startsWith('dockerfile')) return BY_NAME.dockerfile
  if (name.startsWith('tsconfig') && name.endsWith('.json')) return BY_NAME['tsconfig.json']
  if (/^(vite|vitest|webpack|rollup|electron\.vite|next|nuxt|tailwind|postcss|eslint|prettier|babel|jest|playwright|svelte|astro)\.config\./.test(name)) {
    return spec(FileCog, 'text-accent-2')
  }
  if (name.endsWith('.d.ts')) return spec(FileCode, 'text-accent-2')
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return spec(FileCode, 'text-success')
  const dot = name.lastIndexOf('.')
  if (dot > 0) {
    const ext = name.slice(dot + 1)
    return BY_EXT[ext] ?? DEFAULT_FILE
  }
  return DEFAULT_FILE
}

/** Icon for a folder name in its open / closed state. */
export function getFolderIcon(name: string, open: boolean): FileIconSpec {
  const s = FOLDER_BY_NAME[name.toLowerCase()] ?? FOLDER_DEFAULT
  return { icon: open ? s.open : s.closed, className: s.className }
}

export interface FileIconProps {
  /** File or folder name (a full path works too). */
  name: string
  isDirectory?: boolean
  open?: boolean
  size?: number
  className?: string
}

export function FileIcon({ name, isDirectory, open = false, size = 16, className }: FileIconProps) {
  const s = isDirectory ? getFolderIcon(name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1), open) : getFileIcon(name)
  const Icon = s.icon
  return <Icon size={size} strokeWidth={1.75} className={cn('shrink-0', s.className, className)} aria-hidden />
}
