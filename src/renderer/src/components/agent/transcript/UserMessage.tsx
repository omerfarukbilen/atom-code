import { memo, useEffect, useState, type ReactNode } from 'react'
import { Check, CircleAlert, Clock, Copy, GitCompare, Image as ImageIcon, RotateCcw, Terminal, TriangleAlert } from 'lucide-react'
import type { ContextAttachment, RewindResult } from '@shared/types'
import { basename } from '@shared/paths'
import { cn } from '../../../lib/cn'
import { FileIcon } from '../../../lib/file-icons'
import { isRunning } from '../../../lib/agent-reducer'
import type { UserItem } from '../../../lib/agent-types'
import { useAgentStore } from '../../../stores/agent'
import { Button, Modal, Spinner } from '../../ui'
import { useCopy, useTranscript } from './context'
import { displayPath, lineRangeLabel, openPath } from './file-links'
import { clockTime, plural, truncate } from './format'

// ─────────────────────────────────────────────────────────────────────────────
// Attachments
// ─────────────────────────────────────────────────────────────────────────────

function Chip({ icon, label, title, onClick }: { icon: ReactNode; label: ReactNode; title: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex h-[22px] max-w-[220px] items-center gap-1 rounded-md border border-line bg-panel px-1.5 text-[11.5px] text-muted transition-colors enabled:hover:border-line-strong enabled:hover:text-fg disabled:cursor-default"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

export function AttachmentChip({ att }: { att: ContextAttachment }) {
  const { workspace } = useTranscript()
  switch (att.type) {
    case 'file':
      return (
        <Chip
          icon={<FileIcon name={att.path} size={12} />}
          label={basename(att.path)}
          title={`Open ${displayPath(att.path, workspace)}`}
          onClick={() => openPath(att.path, workspace)}
        />
      )
    case 'folder':
      return <Chip icon={<FileIcon name={att.path} isDirectory size={12} />} label={`${basename(att.path)}/`} title={displayPath(att.path, workspace)} />
    case 'selection': {
      const range = lineRangeLabel(att.startLine, att.endLine)
      return (
        <Chip
          icon={<FileIcon name={att.path} size={12} />}
          label={
            <>
              {basename(att.path)} <span className="font-mono text-[10.5px] text-subtle">{range}</span>
            </>
          }
          title={`Selection in ${displayPath(att.path, workspace)} (${range})\n\n${truncate(att.text, 400)}`}
          onClick={() => openPath(att.path, workspace, att.startLine, att.endLine)}
        />
      )
    }
    case 'terminal':
      return <Chip icon={<Terminal size={12} className="text-success" />} label="Terminal output" title={truncate(att.text, 600)} />
    case 'diagnostics':
      return (
        <Chip
          icon={<CircleAlert size={12} className="text-warning" />}
          label={att.path ? `Problems · ${basename(att.path)}` : 'Problems'}
          title={truncate(att.text, 600)}
          onClick={att.path ? () => openPath(att.path, workspace) : undefined}
        />
      )
    case 'git-diff':
      return <Chip icon={<GitCompare size={12} className="text-info" />} label="Git diff" title={truncate(att.text, 600)} />
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore checkpoint
// ─────────────────────────────────────────────────────────────────────────────

function RestoreCheckpointModal({ open, onClose, uuid, chatId }: { open: boolean; onClose(): void; uuid: string; chatId: string }) {
  const { workspace } = useTranscript()
  const [preview, setPreview] = useState<{ loading: boolean; result: RewindResult | null }>({ loading: true, result: null })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPreview({ loading: true, result: null })
    void useAgentStore
      .getState()
      .rewind(uuid, { dryRun: true, chatId })
      .then((result) => {
        if (!cancelled) setPreview({ loading: false, result })
      })
    return () => {
      cancelled = true
    }
  }, [open, uuid, chatId])

  const confirm = async (): Promise<void> => {
    setBusy(true)
    const res = await useAgentStore.getState().rewind(uuid, { chatId })
    setBusy(false)
    if (res?.canRewind) onClose()
  }

  const { loading, result } = preview
  const files = result?.filesChanged ?? []
  const blocked = result !== null && !result.canRewind

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Restore checkpoint?"
      description="Files ATOM changed after this message go back to how they were before it was sent. The conversation itself is kept."
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" icon={<RotateCcw size={13} />} loading={busy} disabled={loading || blocked} onClick={() => void confirm()}>
            Restore files
          </Button>
        </>
      }
    >
      <div className="px-5 py-4 text-[12.5px]">
        {loading ? (
          <div className="flex items-center gap-2 text-muted">
            <Spinner size={13} /> Checking which files would change…
          </div>
        ) : blocked ? (
          <div className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-danger">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span className="selectable">{result?.error || 'This checkpoint cannot be restored.'}</span>
          </div>
        ) : result === null ? (
          <div className="text-muted">Could not preview the changes. Restoring will still be attempted.</div>
        ) : files.length === 0 ? (
          <div className="text-muted">No files need to change — they already match this checkpoint.</div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2 text-muted">
              <span>{plural(files.length, 'file')} will be restored</span>
              {(result.insertions ?? 0) + (result.deletions ?? 0) > 0 && (
                <span className="font-mono text-[11px]">
                  <span className="text-success">+{result.insertions ?? 0}</span> <span className="text-danger">−{result.deletions ?? 0}</span>
                </span>
              )}
            </div>
            <ul className="max-h-[240px] overflow-y-auto rounded-md border border-line bg-panel py-1">
              {files.map((f) => (
                <li key={f} className="flex min-w-0 items-center gap-1.5 px-2.5 py-[3px]">
                  <FileIcon name={f} size={13} />
                  <span className="truncate font-mono text-[11.5px] text-fg">{displayPath(f, workspace)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}

function ImagePreviewModal({ src, onClose }: { src: string | null; onClose(): void }) {
  return (
    <Modal open={!!src} onClose={onClose} title="Image" width="max-w-3xl">
      {src && (
        <div className="flex items-center justify-center bg-input p-4">
          <img src={src} alt="Attached" className="max-h-[65vh] max-w-full rounded-md object-contain" />
        </div>
      )}
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// User message
// ─────────────────────────────────────────────────────────────────────────────

const COLLAPSE_LINES = 14

export const UserMessage = memo(function UserMessage({ item }: { item: UserItem }) {
  const { chatId } = useTranscript()
  const running = useAgentStore((s) => {
    const c = s.chats[chatId]
    return c ? isRunning(c) : false
  })
  const [copied, copy] = useCopy()
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  const lines = item.text.split('\n')
  const long = lines.length > COLLAPSE_LINES + 2 || item.text.length > 1600
  const shown = long && !expanded ? truncate(lines.slice(0, COLLAPSE_LINES).join('\n'), 1400) : item.text
  const missingImages = Math.max(0, item.imageCount - item.thumbnails.length)
  const hasMedia = item.attachments.length > 0 || item.imageCount > 0

  return (
    <div className="group/user flex flex-col items-end">
      <div
        className={cn(
          'min-w-[48px] max-w-[88%] rounded-xl rounded-br-[5px] border bg-elevated px-3 py-2 shadow-sm',
          item.failed ? 'border-danger/60' : 'border-line',
          (item.pending || item.queued) && 'opacity-75'
        )}
      >
        {hasMedia && (
          <div className={cn('flex flex-wrap items-center gap-1', item.text && 'mb-1.5')}>
            {item.thumbnails.map((src, i) => (
              <button
                key={i}
                type="button"
                title="View image"
                onClick={() => setPreview(src)}
                className="h-12 w-12 overflow-hidden rounded-md border border-line bg-input hover:border-line-strong"
              >
                <img src={src} alt={`Attached image ${i + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
            {missingImages > 0 && (
              <Chip icon={<ImageIcon size={12} />} label={missingImages > 1 ? `${missingImages} images` : 'Image'} title="Image attached to this message" />
            )}
            {item.attachments.map((att, i) => (
              <AttachmentChip key={i} att={att} />
            ))}
          </div>
        )}
        {item.text && <div className="selectable whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{shown}</div>}
        {long && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-[11.5px] text-accent hover:underline">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      <div className="mt-0.5 flex h-5 items-center gap-1 text-[11px] text-subtle">
        {item.queued && (
          <span className="flex items-center gap-1 text-info" title="Will be sent to ATOM as soon as possible">
            <Clock size={11} /> Queued
          </span>
        )}
        {item.pending && !item.queued && !item.failed && <span>Sending…</span>}
        {item.failed && (
          <span className="flex items-center gap-1 text-danger" title={item.failed}>
            <CircleAlert size={11} /> Not sent: {truncate(item.failed, 80)}
          </span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/user:opacity-100">
          {!item.fromHistory && <span className="px-1 tabular-nums">{clockTime(item.createdAt)}</span>}
          <button
            type="button"
            title={copied ? 'Copied' : 'Copy message'}
            onClick={() => copy(item.text)}
            className="flex h-5 w-5 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg"
          >
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
          {item.checkpoint && !item.pending && (
            <button
              type="button"
              disabled={running}
              title={running ? 'Stop the agent to restore this checkpoint' : 'Restore files to their state before this message'}
              onClick={() => setRestoreOpen(true)}
              className="flex h-5 items-center gap-1 rounded px-1.5 text-subtle hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              <RotateCcw size={11} />
              Restore checkpoint
            </button>
          )}
        </div>
      </div>
      {restoreOpen && <RestoreCheckpointModal open={restoreOpen} onClose={() => setRestoreOpen(false)} uuid={item.uuid} chatId={chatId} />}
      <ImagePreviewModal src={preview} onClose={() => setPreview(null)} />
    </div>
  )
})
