import { memo, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { highlightLanguageFor, highlightLine, rowsFromHunks, type DiffRow, type Hunk } from './diff'

export interface DiffViewProps {
  hunks: Hunk[]
  /** File path (for syntax highlighting). */
  path: string
  /** Show old/new line number gutters (only when the numbers refer to real file lines). */
  lineNumbers?: boolean
  /** Shift snippet-relative hunks to real file lines. */
  lineOffset?: number
  /** Rows shown before "Show all" (default 40). */
  maxRows?: number
  className?: string
  /** Text shown when there are no changes. */
  emptyText?: string
}

const ROW_BG: Record<DiffRow['kind'], string> = {
  add: 'bg-diff-add',
  del: 'bg-diff-del',
  ctx: '',
  hunk: 'bg-hover',
  note: ''
}

const SIGN: Record<DiffRow['kind'], string> = { add: '+', del: '−', ctx: ' ', hunk: '', note: '' }

function Row({ row, language, lineNumbers }: { row: DiffRow; language: string; lineNumbers: boolean }) {
  if (row.kind === 'hunk') {
    return (
      <tr className="bg-hover text-subtle">
        {lineNumbers && <td colSpan={2} className="select-none px-2 text-right">⋯</td>}
        <td colSpan={2} className="select-none px-2 py-px">
          {row.text}
        </td>
      </tr>
    )
  }
  if (row.kind === 'note') {
    return (
      <tr className="text-subtle">
        {lineNumbers && <td colSpan={2} />}
        <td colSpan={2} className="px-2 italic">
          {row.text}
        </td>
      </tr>
    )
  }
  const html = highlightLine(row.text, language)
  return (
    <tr className={ROW_BG[row.kind]}>
      {lineNumbers && (
        <>
          <td className="w-[1%] select-none whitespace-nowrap pl-2 pr-1 text-right align-top text-subtle/70">{row.oldNo ?? ''}</td>
          <td className="w-[1%] select-none whitespace-nowrap pl-1 pr-1 text-right align-top text-subtle/70">{row.newNo ?? ''}</td>
        </>
      )}
      <td
        className={cn(
          'w-[1%] select-none whitespace-nowrap px-1.5 text-center align-top',
          row.kind === 'add' ? 'text-success' : row.kind === 'del' ? 'text-danger' : 'text-subtle'
        )}
      >
        {SIGN[row.kind]}
      </td>
      {html !== null ? (
        <td className="hljs whitespace-pre pr-3" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <td className="whitespace-pre pr-3">{row.text || ' '}</td>
      )}
    </tr>
  )
}

/** Unified inline diff with add/delete backgrounds, optional line numbers and "Show all" collapsing. */
export const DiffView = memo(function DiffView({ hunks, path, lineNumbers = false, lineOffset = 0, maxRows = 40, className, emptyText = 'No changes' }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false)
  const rows = useMemo(() => rowsFromHunks(hunks, lineOffset), [hunks, lineOffset])
  const language = useMemo(() => highlightLanguageFor(path), [path])
  if (!rows.length) return <div className={cn('px-3 py-2 text-[11.5px] italic text-subtle', className)}>{emptyText}</div>
  const visible = expanded || rows.length <= maxRows + 4 ? rows : rows.slice(0, maxRows)
  const hidden = rows.length - visible.length
  return (
    <div className={cn('selectable', className)}>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse font-mono text-[11.5px] leading-[18px] text-fg">
          <tbody>
            {visible.map((row, i) => (
              <Row key={i} row={row} language={language} lineNumbers={lineNumbers} />
            ))}
          </tbody>
        </table>
      </div>
      {(hidden > 0 || (expanded && rows.length > maxRows + 4)) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-line py-1 text-[11px] text-muted hover:bg-hover hover:text-fg"
        >
          <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Collapse' : `Show all ${rows.length} lines (${hidden} more)`}
        </button>
      )}
    </div>
  )
})
