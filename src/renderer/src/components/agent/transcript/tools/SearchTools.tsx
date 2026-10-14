import { useMemo, useState } from 'react'
import { ExternalLink, FolderSearch, Globe, Search } from 'lucide-react'
import { atom } from '../../../../lib/api'
import type { ToolCall } from '../../../../lib/agent-types'
import { FileIcon } from '../../../../lib/file-icons'
import { useDepth, useTranscript } from '../context'
import { displayPath, looksLikeFilePath, openPath } from '../file-links'
import { arr, hostOf, isObj, num, plural, shortUrl, str, truncate } from '../format'
import { Markdown } from '../Markdown'
import { DetailSection, Mono, ToolAction, ToolShell } from '../ToolShell'

// ─────────────────────────────────────────────────────────────────────────────
// Shared lists
// ─────────────────────────────────────────────────────────────────────────────

export function FileList({ files, limit = 25 }: { files: string[]; limit?: number }) {
  const { workspace } = useTranscript()
  const [all, setAll] = useState(false)
  if (!files.length) return <div className="px-2.5 py-1.5 text-[11.5px] italic text-subtle">No files</div>
  const shown = all ? files : files.slice(0, limit)
  return (
    <div className="max-h-[360px] overflow-y-auto py-1">
      {shown.map((f) => (
        <button
          key={f}
          type="button"
          title={`Open ${f}`}
          onClick={() => openPath(f, workspace)}
          className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-[3px] text-left text-[12px] text-muted hover:bg-hover hover:text-fg"
        >
          <FileIcon name={f} size={13} />
          <span className="truncate font-mono text-[11.5px]">{displayPath(f, workspace)}</span>
        </button>
      ))}
      {files.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="px-2.5 py-1 text-[11px] text-accent hover:underline">
          Show {files.length - shown.length} more
        </button>
      )}
    </div>
  )
}

const GREP_LINE_RE = /^(.+?)([:-])(\d+)\2(.*)$/

function GrepContent({ text }: { text: string }) {
  const { workspace } = useTranscript()
  const [all, setAll] = useState(false)
  const lines = text.replace(/\n+$/, '').split('\n')
  const shown = all ? lines : lines.slice(0, 60)
  return (
    <div className="selectable max-h-[400px] overflow-auto py-1 font-mono text-[11.5px] leading-[17px]">
      {shown.map((line, i) => {
        const m = GREP_LINE_RE.exec(line)
        if (m && looksLikeFilePath(m[1])) {
          const lineNo = Number(m[3])
          const isMatch = m[2] === ':'
          return (
            <div key={i} className="flex min-w-0 gap-2 whitespace-pre px-2.5 hover:bg-hover">
              <button
                type="button"
                title={`Open ${m[1]}:${lineNo}`}
                onClick={() => openPath(m[1], workspace, lineNo)}
                className="shrink-0 text-accent hover:underline"
              >
                {displayPath(m[1], workspace)}:{lineNo}
              </button>
              <span className={isMatch ? 'text-fg' : 'text-subtle'}>{m[4]}</span>
            </div>
          )
        }
        return (
          <div key={i} className="whitespace-pre px-2.5 text-muted">
            {line || ' '}
          </div>
        )
      })}
      {lines.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="px-2.5 py-1 font-sans text-[11px] text-accent hover:underline">
          Show {lines.length - shown.length} more lines
        </button>
      )}
    </div>
  )
}

/** File paths from a plain tool result ("Found 3 files\n/a\n/b…"). */
function filesFromText(text: string | undefined): string[] {
  if (!text) return []
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^Found \d+/i.test(l) && !/^No (files|matches)/i.test(l) && !/^\(Results are truncated/i.test(l) && looksLikeFilePath(l))
}

function stringList(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string')
}

// ─────────────────────────────────────────────────────────────────────────────
// Grep
// ─────────────────────────────────────────────────────────────────────────────

export function GrepTool({ tool }: { tool: ToolCall }) {
  const { workspace } = useTranscript()
  const pattern = str(tool.input.pattern) ?? ''
  const path = str(tool.input.path)
  const glob = str(tool.input.glob) ?? (str(tool.input.type) ? `*.${str(tool.input.type)}` : undefined)
  const s = isObj(tool.structured) ? tool.structured : null
  const mode = (s ? str(s.mode) : undefined) ?? str(tool.input.output_mode) ?? 'files_with_matches'
  const files = useMemo(() => (s ? stringList(s.filenames) : mode === 'files_with_matches' ? filesFromText(tool.result?.text) : []), [s, mode, tool.result?.text])
  const content = s ? str(s.content) : mode !== 'files_with_matches' ? tool.result?.text : undefined
  const numFiles = s ? num(s.numFiles) : files.length || undefined
  const numMatches = s ? (num(s.numMatches) ?? num(s.numLines)) : undefined
  const count =
    tool.status !== 'success'
      ? ''
      : mode === 'content'
        ? numMatches !== undefined
          ? plural(numMatches, 'match', 'matches')
          : ''
        : mode === 'count' && numMatches !== undefined
          ? plural(numMatches, 'match', 'matches')
          : numFiles !== undefined
            ? plural(numFiles, 'file')
            : ''
  const hasBody = tool.status === 'success' && (files.length > 0 || !!content?.trim())

  return (
    <ToolShell
      tool={tool}
      icon={Search}
      title={
        <>
          <span className="shrink-0">Searched</span>
          <Mono className="text-fg" title={pattern}>
            {truncate(pattern, 60) || '…'}
          </Mono>
          {path && (
            <>
              <span className="shrink-0 text-subtle">in</span>
              <Mono title={path}>{displayPath(path, workspace) || path}</Mono>
            </>
          )}
          {glob && <Mono className="text-subtle">{glob}</Mono>}
        </>
      }
      meta={count ? <span className="shrink-0 text-[11px] text-subtle">{count}</span> : undefined}
    >
      {hasBody ? content?.trim() && mode !== 'files_with_matches' ? <GrepContent text={content} /> : <FileList files={files} /> : undefined}
    </ToolShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Glob
// ─────────────────────────────────────────────────────────────────────────────

export function GlobTool({ tool }: { tool: ToolCall }) {
  const { workspace } = useTranscript()
  const pattern = str(tool.input.pattern) ?? ''
  const path = str(tool.input.path)
  const s = isObj(tool.structured) ? tool.structured : null
  const files = useMemo(() => (s ? stringList(s.filenames) : filesFromText(tool.result?.text)), [s, tool.result?.text])
  const total = s ? (num(s.totalMatches) ?? num(s.numFiles)) : files.length
  const truncated = s?.truncated === true
  return (
    <ToolShell
      tool={tool}
      icon={FolderSearch}
      title={
        <>
          <span className="shrink-0">Found files</span>
          <Mono className="text-fg" title={pattern}>
            {truncate(pattern, 60) || '…'}
          </Mono>
          {path && (
            <>
              <span className="shrink-0 text-subtle">in</span>
              <Mono title={path}>{displayPath(path, workspace) || path}</Mono>
            </>
          )}
        </>
      }
      meta={
        tool.status === 'success' && total !== undefined ? (
          <span className="shrink-0 text-[11px] text-subtle">
            {plural(total, 'file')}
            {truncated ? '+' : ''}
          </span>
        ) : undefined
      }
    >
      {tool.status === 'success' && files.length ? <FileList files={files} /> : undefined}
    </ToolShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSearch / WebFetch
// ─────────────────────────────────────────────────────────────────────────────

interface SearchHit {
  title: string
  url: string
}

function hitsFrom(tool: ToolCall): SearchHit[] {
  const out: SearchHit[] = []
  const push = (v: unknown): void => {
    if (isObj(v) && typeof v.url === 'string') out.push({ title: str(v.title) ?? v.url, url: v.url })
  }
  const s = tool.structured
  if (isObj(s)) {
    for (const r of arr(s.results)) {
      if (isObj(r)) arr(r.content).forEach(push)
    }
  } else if (Array.isArray(s)) {
    // Server-side web_search_tool_result content: [{type:'web_search_result', title, url}]
    s.forEach(push)
  }
  if (!out.length && tool.result?.text) {
    const m = /Links:\s*(\[[\s\S]*?\])\s*(?:\n|$)/.exec(tool.result.text)
    if (m) {
      try {
        arr(JSON.parse(m[1]) as unknown).forEach(push)
      } catch {
        /* not JSON */
      }
    }
  }
  const seen = new Set<string>()
  return out.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
}

export function WebSearchTool({ tool }: { tool: ToolCall }) {
  const query = str(tool.input.query) ?? ''
  const hits = useMemo(() => hitsFrom(tool), [tool])
  return (
    <ToolShell
      tool={tool}
      icon={Globe}
      title={
        <>
          <span className="shrink-0">Searched the web</span>
          <Mono className="text-fg" title={query}>
            {truncate(query, 80) || '…'}
          </Mono>
        </>
      }
      meta={hits.length ? <span className="shrink-0 text-[11px] text-subtle">{plural(hits.length, 'result')}</span> : undefined}
    >
      {hits.length ? (
        <div className="max-h-[320px] overflow-y-auto py-1">
          {hits.map((h) => (
            <button
              key={h.url}
              type="button"
              title={h.url}
              onClick={() => void atom.app.openExternal(h.url)}
              className="flex w-full min-w-0 items-baseline gap-2 px-2.5 py-[3px] text-left text-[12px] hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate text-fg">{h.title}</span>
              <span className="shrink-0 text-[11px] text-subtle">{hostOf(h.url)}</span>
            </button>
          ))}
        </div>
      ) : undefined}
    </ToolShell>
  )
}

export function WebFetchTool({ tool }: { tool: ToolCall }) {
  const depth = useDepth()
  const url = str(tool.input.url) ?? ''
  const prompt = str(tool.input.prompt)
  const s = isObj(tool.structured) ? tool.structured : null
  const code = s ? num(s.code) : undefined
  const codeText = s ? str(s.codeText) : undefined
  const result = (s ? str(s.result) : undefined) ?? (tool.status === 'success' ? tool.result?.text : undefined)
  const [expanded, setExpanded] = useState(false)
  const long = (result?.length ?? 0) > 1200
  return (
    <ToolShell
      tool={tool}
      icon={Globe}
      titleTooltip={url}
      title={
        <>
          <span className="shrink-0">Fetched</span>
          <Mono className="text-fg" title={url}>
            {shortUrl(url) || '…'}
          </Mono>
        </>
      }
      meta={
        <>
          {code !== undefined && code >= 300 && (
            <span className="shrink-0 text-[11px] text-warning">
              {code} {codeText}
            </span>
          )}
          {url && depth === 0 && <ToolAction icon={ExternalLink} label="" title="Open in browser" onClick={() => void atom.app.openExternal(url)} />}
        </>
      }
    >
      {result || prompt ? (
        <>
          {prompt && (
            <DetailSection label="Prompt">
              <div className="selectable text-[12px] italic text-muted">{prompt}</div>
            </DetailSection>
          )}
          {result && (
            <DetailSection label="Result">
              <div className={long && !expanded ? 'relative max-h-[220px] overflow-hidden' : undefined}>
                <Markdown content={result} className="!text-[12px]" />
                {long && !expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-elevated to-transparent" />}
              </div>
              {long && (
                <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-[11px] text-accent hover:underline">
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </DetailSection>
          )}
        </>
      ) : undefined}
    </ToolShell>
  )
}
