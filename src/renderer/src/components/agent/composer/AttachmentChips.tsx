import { memo, type ReactNode } from 'react'
import { GitCompareArrows, SquareTerminal, TriangleAlert, X } from 'lucide-react'
import type { ContextAttachment, ImageAttachment } from '@shared/types'
import { cn } from '../../../lib/cn'
import { FileIcon } from '../../../lib/file-icons'
import { useAgentStore } from '../../../stores/agent'
import { useEditorStore } from '../../../stores/editor'
import { attachmentLabel, attachmentTitle, diffFileCount, lineCount } from './attachments'

function attachmentIcon(a: ContextAttachment): ReactNode {
  switch (a.type) {
    case 'file':
    case 'selection':
      return <FileIcon name={a.path} size={13} />
    case 'folder':
      return <FileIcon name={a.path} isDirectory size={13} />
    case 'terminal':
      return <SquareTerminal size={13} className="text-success" />
    case 'diagnostics':
      return <TriangleAlert size={13} className="text-warning" />
    case 'git-diff':
      return <GitCompareArrows size={13} className="text-accent-2" />
  }
}

function attachmentMeta(a: ContextAttachment): string | null {
  switch (a.type) {
    case 'terminal':
      return `${lineCount(a.text)}L`
    case 'diagnostics':
      return String(lineCount(a.text))
    case 'git-diff': {
      const n = diffFileCount(a.text)
      return n ? `${n}F` : null
    }
    default:
      return null
  }
}

function Chip({ icon, label, meta, title, onOpen, onRemove }: { icon: ReactNode; label: string; meta?: string | null; title: string; onOpen?: () => void; onRemove(): void }) {
  return (
    <span
      title={title}
      className={cn(
        'group/chip inline-flex h-6 max-w-[220px] items-center gap-1 rounded-md border border-line bg-panel pl-1.5 pr-0.5 text-[11.5px] text-fg animate-fade-in',
        onOpen && 'hover:border-line-strong'
      )}
    >
      <span className="flex shrink-0 items-center">{icon}</span>
      <button type="button" onClick={onOpen} disabled={!onOpen} className="min-w-0 truncate text-left disabled:cursor-default">
        {label}
      </button>
      {meta && <span className="shrink-0 font-mono text-[10px] text-subtle">{meta}</span>}
      <button
        type="button"
        title="Remove"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg"
      >
        <X size={11} />
      </button>
    </span>
  )
}

interface AttachmentChipsProps {
  chatId: string
  attachments: ContextAttachment[]
  images: ImageAttachment[]
  workspace: string
}

/** Removable chips for the composer's context attachments and pasted images. */
export const AttachmentChips = memo(function AttachmentChips({ chatId, attachments, images, workspace }: AttachmentChipsProps) {
  if (!attachments.length && !images.length) return null
  const store = useAgentStore.getState

  return (
    <div className="flex flex-wrap gap-1 px-2 pt-2">
      {attachments.map((a, i) => {
        const open =
          a.type === 'file' || a.type === 'selection'
            ? () => void useEditorStore.getState().openFile(a.path, a.type === 'selection' ? { line: a.startLine, endLine: a.endLine } : undefined)
            : undefined
        return (
          <Chip
            key={`${a.type}:${'path' in a ? a.path : ''}:${a.type === 'selection' ? `${a.startLine}-${a.endLine}` : i}`}
            icon={attachmentIcon(a)}
            label={attachmentLabel(a)}
            meta={attachmentMeta(a)}
            title={attachmentTitle(a, workspace)}
            onOpen={open}
            onRemove={() => store().removeAttachment(i, chatId)}
          />
        )
      })}
      {images.map((img, i) => (
        <span
          key={`img:${i}:${img.data.length}`}
          title={`${img.name ?? 'Image'} · ${Math.max(1, Math.round((img.data.length * 3) / 4 / 1024))} KB`}
          className="group/chip inline-flex h-6 max-w-[180px] items-center gap-1 rounded-md border border-line bg-panel pl-0.5 pr-0.5 text-[11.5px] text-fg animate-fade-in"
        >
          <img src={`data:${img.mediaType};base64,${img.data}`} alt="" className="h-5 w-5 shrink-0 rounded object-cover" draggable={false} />
          <span className="min-w-0 truncate">{img.name ?? 'Image'}</span>
          <button
            type="button"
            title="Remove image"
            aria-label="Remove image"
            onClick={() => store().removeImage(i, chatId)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg"
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  )
})
