import { memo, useEffect, useRef, type ReactNode } from 'react'
import { CaseSensitive, ChevronRight, ChevronsDownUp, ChevronsUpDown, Ellipsis, Regex, RefreshCw, Search, WholeWord, X } from 'lucide-react'
import type { SearchFileResult, SearchMatch } from '@shared/types'
import { basename } from '@shared/paths'
import { cn } from '../../lib/cn'
import { FileIcon } from '../../lib/file-icons'
import { useEditorStore } from '../../stores/editor'
import { useWorkspaceStore } from '../../stores/workspace'
import { Badge, Button, EmptyState, IconButton, Spinner } from '../ui'
import { ViewHeader } from '../workbench/ViewHeader'
import { useSearchStore } from './searchStore'

export function SearchView() {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const s = useSearchStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [s.focusNonce])

  const files = s.result?.files ?? []
  const allCollapsed = files.length > 0 && files.every((f) => s.collapsed[f.path])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title="Search"
        actions={
          <>
            <IconButton title="Refresh" icon={<RefreshCw size={14} />} disabled={!s.query} onClick={() => void s.run()} />
            <IconButton title="Clear Search Results" icon={<X size={15} />} disabled={!s.query && !s.result} onClick={() => s.clear()} />
            <IconButton
              title={allCollapsed ? 'Expand All' : 'Collapse All'}
              icon={allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
              disabled={files.length === 0}
              onClick={() => s.setAllCollapsed(!allCollapsed)}
            />
          </>
        }
      />

      <div className="shrink-0 space-y-1.5 px-3 pb-2">
        <div className="flex h-[30px] items-center gap-1 rounded-md border border-line bg-input pl-2 pr-1 transition-colors focus-within:border-accent">
          <Search size={13} className="shrink-0 text-subtle" />
          <input
            ref={inputRef}
            value={s.query}
            spellCheck={false}
            placeholder="Search"
            onChange={(e) => s.set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void s.run()
              } else if (e.key === 'Escape' && s.query) {
                e.preventDefault()
                s.clear()
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-subtle"
          />
          <OptionToggle title="Match Case" active={s.caseSensitive} onClick={() => s.set({ caseSensitive: !s.caseSensitive })}>
            <CaseSensitive size={15} />
          </OptionToggle>
          <OptionToggle title="Match Whole Word" active={s.wholeWord} onClick={() => s.set({ wholeWord: !s.wholeWord })}>
            <WholeWord size={15} />
          </OptionToggle>
          <OptionToggle title="Use Regular Expression" active={s.isRegex} onClick={() => s.set({ isRegex: !s.isRegex })}>
            <Regex size={14} />
          </OptionToggle>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            title="Toggle Search Details"
            onClick={() => s.set({ showDetails: !s.showDetails })}
            className={cn('rounded px-1 text-subtle hover:bg-hover hover:text-fg', s.showDetails && 'text-fg')}
          >
            <Ellipsis size={14} />
          </button>
        </div>
        {s.showDetails && (
          <div className="space-y-1.5 animate-fade-in">
            <GlobInput label="files to include" value={s.include} placeholder="e.g. src/**, *.ts" onChange={(v) => s.set({ include: v })} />
            <GlobInput label="files to exclude" value={s.exclude} placeholder="e.g. **/*.test.ts, dist" onChange={(v) => s.set({ exclude: v })} />
          </div>
        )}
      </div>

      <SummaryLine />

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {!workspace ? (
          <EmptyState title="No folder opened" description="Open a folder to search across its files." />
        ) : s.error ? (
          <div className="mx-3 rounded-md border border-danger/40 bg-danger-soft px-2.5 py-2 text-[12px] text-danger selectable">{s.error}</div>
        ) : s.result && files.length === 0 && !s.searching ? (
          <div className="px-4 py-2 text-[12px] text-muted">
            No results found. Review your settings for configured exclusions and check your gitignore files.
          </div>
        ) : !s.query ? (
          <div className="px-4 py-2 text-[12px] leading-relaxed text-subtle">
            Search across all files in <span className="text-muted">{workspace.name}</span>. Results respect <code className="font-mono">.gitignore</code>.
          </div>
        ) : (
          files.map((f) => <FileResult key={f.path} file={f} collapsed={!!s.collapsed[f.path]} />)
        )}
      </div>
    </div>
  )
}

function SummaryLine() {
  const result = useSearchStore((s) => s.result)
  const searching = useSearchStore((s) => s.searching)
  const query = useSearchStore((s) => s.query)
  if (!query) return null
  return (
    <div className="flex h-6 shrink-0 items-center gap-2 px-4 text-[11.5px] text-subtle">
      {searching && <Spinner size={10} />}
      {result ? (
        <span className="truncate">
          {result.totalMatches.toLocaleString()} result{result.totalMatches === 1 ? '' : 's'} in {result.files.length.toLocaleString()} file
          {result.files.length === 1 ? '' : 's'}
          <span className="text-subtle/80"> · {Math.round(result.durationMs)} ms</span>
        </span>
      ) : searching ? (
        <span>Searching…</span>
      ) : null}
      {result?.truncated && (
        <Badge tone="warning" className="ml-auto" title="Showing the first 2000 matches — refine your query">
          truncated
        </Badge>
      )}
    </div>
  )
}

function OptionToggle({ title, active, onClick, children }: { title: string; active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded border text-muted transition-colors',
        active ? 'border-accent/60 bg-accent-soft text-accent' : 'border-transparent hover:bg-hover hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}

function GlobInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange(v: string): void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-subtle">{label}</span>
      <input
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-[26px] w-full rounded-md border border-line bg-input px-2 text-[12.5px] text-fg outline-none transition-colors placeholder:text-subtle focus:border-accent"
      />
    </label>
  )
}

const FileResult = memo(function FileResult({ file, collapsed }: { file: SearchFileResult; collapsed: boolean }) {
  const toggle = useSearchStore((s) => s.toggleCollapsed)
  const name = basename(file.relativePath)
  const dir = file.relativePath.slice(0, Math.max(0, file.relativePath.length - name.length - 1))
  return (
    <div>
      <button
        type="button"
        title={file.path}
        onClick={() => toggle(file.path)}
        className="group flex h-[22px] w-full items-center gap-1 pl-2 pr-3 text-left hover:bg-hover"
      >
        <ChevronRight size={14} className={cn('shrink-0 text-subtle transition-transform duration-100', !collapsed && 'rotate-90')} />
        <FileIcon name={name} size={15} />
        <span className="shrink-0 truncate text-[13px] text-fg">{name}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-subtle">{dir}</span>
        <span className="ml-1 shrink-0 rounded-full bg-active px-1.5 text-[10.5px] font-medium leading-4 text-muted">{file.matches.length}</span>
      </button>
      {!collapsed && file.matches.map((m, i) => <MatchRow key={`${m.line}:${m.column}:${i}`} path={file.path} match={m} />)}
    </div>
  )
})

const MatchRow = memo(function MatchRow({ path, match }: { path: string; match: SearchMatch }) {
  const { before, hit, after } = splitPreview(match)
  const open = (preview: boolean): void => {
    void useEditorStore.getState().openFile(path, { line: match.line, column: match.column, preview, focus: !preview })
  }
  return (
    <button
      type="button"
      title={`Line ${match.line}`}
      onClick={() => open(true)}
      onDoubleClick={() => open(false)}
      className="flex h-[22px] w-full items-center gap-2 pl-[38px] pr-3 text-left hover:bg-hover"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
        {before}
        <span className="rounded-[2px] bg-warning-soft text-fg outline outline-1 outline-warning/40">{hit}</span>
        {after}
      </span>
      <span className="shrink-0 font-mono text-[10.5px] text-subtle">{match.line}</span>
    </button>
  )
})

/** Trims leading whitespace and shortens long prefixes so the hit stays visible in a narrow sidebar. */
function splitPreview(m: SearchMatch): { before: string; hit: string; after: string } {
  const start = Math.max(0, m.column - 1)
  const text = m.preview
  let before = text.slice(0, start).replace(/^\s+/, '')
  const hit = text.slice(start, start + m.length) || ' '
  const after = text.slice(start + m.length)
  if (before.length > 28) before = '…' + before.slice(before.length - 26)
  return { before, hit, after }
}
