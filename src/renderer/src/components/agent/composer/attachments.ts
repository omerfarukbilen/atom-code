/**
 * Turning pasted / dropped / picked data into composer attachments: images become base64
 * `ImageAttachment`s (≤ 5 MB, png/jpeg/gif/webp), paths dragged from the Explorer become file / folder
 * context attachments.
 */
import type { ContextAttachment, ImageAttachment } from '@shared/types'
import { basename, extname, isInside, relativePath } from '@shared/paths'
import { atom } from '../../../lib/api'
import { useAgentStore } from '../../../stores/agent'
import { toast } from '../../../stores/toast'
import { useWorkspaceStore } from '../../../stores/workspace'
import { pluralize } from './utils'

export const IMAGE_MEDIA_TYPES: ImageAttachment['mediaType'][] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const EXT_TO_MEDIA: Record<string, ImageAttachment['mediaType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** Explorer drag payload (see ExplorerTree). */
export const EXPLORER_DRAG_MIME = 'application/x-atom-path'

function mediaTypeOf(file: File): ImageAttachment['mediaType'] | null {
  const t = file.type.toLowerCase()
  const byType = IMAGE_MEDIA_TYPES.find((m) => m === t)
  if (byType) return byType
  return EXT_TO_MEDIA[extname(file.name)] ?? null
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || !!EXT_TO_MEDIA[extname(file.name)]
}

/** Read an image file as an attachment. Throws an Error with a user-facing message when unsupported. */
export async function imageFromFile(file: File): Promise<ImageAttachment> {
  const mediaType = mediaTypeOf(file)
  const name = file.name || 'Pasted image'
  if (!mediaType) throw new Error(`${name}: only PNG, JPEG, GIF and WebP images are supported.`)
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — images must be 5 MB or smaller.`)
  const dataUrl = await readAsDataUrl(file)
  const comma = dataUrl.indexOf(',')
  return { mediaType, data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, name: file.name || undefined }
}

/** Add image files to a chat's composer; reports problems with a toast. Returns how many were added. */
export async function addImageFiles(files: File[], chatId: string): Promise<number> {
  let added = 0
  const errors: string[] = []
  for (const file of files) {
    try {
      useAgentStore.getState().addImage(await imageFromFile(file), chatId)
      added++
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (errors.length) toast.warning(errors.length === 1 ? 'Image not added' : `${errors.length} images not added`, errors.join('\n'))
  return added
}

/** True when a drag carries something the composer accepts (files, images or Explorer paths). */
export function isAcceptableDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const types = Array.from(dt.types)
  return types.includes('Files') || types.includes(EXPLORER_DRAG_MIME)
}

function parsePathList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('file://') ? decodeURIComponent(l.replace(/^file:\/\//, '')) : l))
}

/** Explorer paths → file / folder attachments (directories detected with stat). */
export async function addPathAttachments(paths: string[], chatId: string): Promise<number> {
  const ws = useWorkspaceStore.getState().workspace?.path ?? ''
  const known = new Set(useWorkspaceStore.getState().files)
  let added = 0
  for (const path of paths) {
    if (ws && !isInside(ws, path)) continue
    let isDirectory = false
    if (!known.has(path)) {
      try {
        isDirectory = (await atom.fs.stat(path)).isDirectory
      } catch {
        continue
      }
    }
    const att: ContextAttachment = isDirectory ? { type: 'folder', path } : { type: 'file', path }
    useAgentStore.getState().addAttachment(att, chatId)
    added++
  }
  return added
}

/** Handle a drop on the agent panel / composer. */
export async function handleDropData(dt: DataTransfer, chatId: string): Promise<void> {
  const explorerPaths = dt.getData(EXPLORER_DRAG_MIME)
  if (explorerPaths) {
    const added = await addPathAttachments(parsePathList(explorerPaths), chatId)
    if (added) useAgentStore.getState().focusComposer()
    return
  }
  const files = Array.from(dt.files)
  if (!files.length) return
  const images = files.filter(isImageFile)
  const others = files.length - images.length
  if (images.length) await addImageFiles(images, chatId)
  if (others) {
    toast.info(
      `${pluralize(others, 'file')} not attached`,
      'Drag files from the ATOM Explorer (or type @ in the chat) to add them as context. Images can be dropped from anywhere.'
    )
  }
  useAgentStore.getState().focusComposer()
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

export function lineCount(text: string): number {
  return text ? text.split('\n').length : 0
}

export function diffFileCount(diff: string): number {
  return (diff.match(/^diff --git /gm) ?? []).length
}

export function attachmentLabel(a: ContextAttachment): string {
  switch (a.type) {
    case 'file':
      return basename(a.path)
    case 'folder':
      return `${basename(a.path)}/`
    case 'selection':
      return `${basename(a.path)}:${a.startLine}${a.endLine !== a.startLine ? `-${a.endLine}` : ''}`
    case 'terminal':
      return 'Terminal'
    case 'diagnostics':
      return 'Problems'
    case 'git-diff':
      return 'Git diff'
  }
}

export function attachmentTitle(a: ContextAttachment, workspace: string): string {
  const rel = (p: string): string => (workspace ? relativePath(workspace, p) || p : p)
  switch (a.type) {
    case 'file':
      return rel(a.path)
    case 'folder':
      return `${rel(a.path)}/`
    case 'selection': {
      const preview = a.text.split('\n').slice(0, 6).join('\n')
      return `${rel(a.path)} · lines ${a.startLine}–${a.endLine}\n\n${preview}${lineCount(a.text) > 6 ? '\n…' : ''}`
    }
    case 'terminal':
      return `Terminal output · ${pluralize(lineCount(a.text), 'line')}`
    case 'diagnostics':
      return `Problems · ${pluralize(lineCount(a.text), 'problem')}`
    case 'git-diff': {
      const n = diffFileCount(a.text)
      return `Uncommitted changes · ${pluralize(n, 'file')}`
    }
  }
}
