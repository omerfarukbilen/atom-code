import type { GitFileChange } from '@shared/types'
import { basename, languageForPath } from '@shared/paths'
import { atom } from '../../lib/api'
import { useEditorStore } from '../../stores/editor'
import { useGitStore } from '../../stores/git'
import { errorMessage, toast } from '../../stores/toast'
import { useWorkspaceStore } from '../../stores/workspace'
import { confirmDialog } from '../ui/ConfirmDialog'

/** Opens a HEAD ↔ working tree diff tab for a changed file. */
export async function openChangeDiff(change: GitFileChange): Promise<void> {
  const root = useWorkspaceStore.getState().workspace?.path
  if (!root) return
  const name = basename(change.path)
  const deleted = change.workingTree === 'D' || (change.index === 'D' && change.workingTree === ' ')
  const added = change.untracked || change.index === 'A'
  try {
    const [original, file] = await Promise.all([
      added ? Promise.resolve('') : atom.git.fileAtHead(root, change.path).then((c) => c ?? ''),
      deleted ? Promise.resolve(null) : atom.fs.readFile(change.path)
    ])
    if (file && (file.isBinary || file.tooLarge)) {
      toast.info(file.tooLarge ? 'File too large to diff' : 'Binary file', 'Opening the file instead.')
      await useEditorStore.getState().openFile(change.path, { preview: true })
      return
    }
    useEditorStore.getState().openDiff({
      path: change.path,
      title: `${name} (${deleted ? 'Deleted' : added ? 'Untracked' : 'Working Tree'})`,
      original,
      modified: file?.content ?? '',
      language: languageForPath(change.path),
      readOnly: deleted
    })
  } catch (err) {
    toast.error(`Could not open diff for ${name}`, errorMessage(err))
  }
}

export async function openChangeFile(change: GitFileChange): Promise<void> {
  if (change.workingTree === 'D') {
    toast.info('This file was deleted', 'Open the diff to see its previous content.')
    return
  }
  await useEditorStore.getState().openFile(change.path, { preview: false })
}

export async function discardChanges(changes: GitFileChange[]): Promise<void> {
  if (changes.length === 0) return
  const untracked = changes.filter((c) => c.untracked)
  const single = changes.length === 1 ? changes[0] : null
  const ok = await confirmDialog({
    title: single
      ? single.untracked
        ? `Delete untracked file '${basename(single.path)}'?`
        : `Discard changes in '${basename(single.path)}'?`
      : `Discard all ${changes.length} changes?`,
    message: single
      ? single.untracked
        ? 'This file is not tracked by Git. Deleting it cannot be undone.'
        : 'Your uncommitted changes to this file will be lost. This cannot be undone.'
      : `This restores ${changes.length - untracked.length} tracked file(s) to HEAD${untracked.length ? ` and deletes ${untracked.length} untracked file(s)` : ''}. This cannot be undone.`,
    confirmLabel: single?.untracked ? 'Delete File' : 'Discard',
    danger: true
  })
  if (!ok) return
  await useGitStore.getState().discard(changes.map((c) => c.path))
}
