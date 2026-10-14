/**
 * Path helpers that work identically in the main process and the renderer (no Node `path`).
 * All functions accept both `/` and `\` separators.
 */

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/')
}

export function basename(p: string): string {
  const n = normalizeSlashes(p).replace(/\/+$/, '')
  const i = n.lastIndexOf('/')
  return i === -1 ? n : n.slice(i + 1)
}

export function dirname(p: string): string {
  const n = normalizeSlashes(p).replace(/\/+$/, '')
  const i = n.lastIndexOf('/')
  if (i === -1) return '.'
  if (i === 0) return '/'
  return p.slice(0, i)
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i).toLowerCase()
}

export function joinPath(...parts: string[]): string {
  const sep = parts.some((p) => p.includes('\\') && !p.includes('/')) ? '\\' : '/'
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(sep)
}

/** Path of `target` relative to `root`, with forward slashes. Returns the target unchanged if outside root. */
export function relativePath(root: string, target: string): string {
  const r = normalizeSlashes(root).replace(/\/+$/, '')
  const t = normalizeSlashes(target)
  if (t === r) return ''
  if (t.toLowerCase().startsWith(r.toLowerCase() + '/')) return t.slice(r.length + 1)
  return t
}

export function isInside(root: string, target: string): boolean {
  const r = normalizeSlashes(root).replace(/\/+$/, '').toLowerCase()
  const t = normalizeSlashes(target).toLowerCase()
  return t === r || t.startsWith(r + '/')
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.htm': 'html',
  '.vue': 'html',
  '.svelte': 'html',
  '.xml': 'xml',
  '.svg': 'xml',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.env': 'ini',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.dart': 'dart',
  '.lua': 'lua',
  '.r': 'r',
  '.dockerfile': 'dockerfile',
  '.proto': 'protobuf',
  '.tf': 'hcl',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.clj': 'clojure',
  '.hs': 'haskell',
  '.pl': 'perl',
  '.txt': 'plaintext',
  '.log': 'plaintext'
}

const LANGUAGE_BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'ignore',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  'claude.md': 'markdown',
  'atom.md': 'markdown'
}

/** Monaco language id for a file path. */
export function languageForPath(p: string): string {
  const name = basename(p).toLowerCase()
  if (LANGUAGE_BY_NAME[name]) return LANGUAGE_BY_NAME[name]
  if (name.startsWith('.env')) return 'ini'
  return LANGUAGE_BY_EXT[extname(p)] ?? 'plaintext'
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif'])

export function isImagePath(p: string): boolean {
  return IMAGE_EXTS.has(extname(p))
}
