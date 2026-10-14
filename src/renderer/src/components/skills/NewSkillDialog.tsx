import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bot, ChevronDown, FolderGit2, Slash, Sparkles, User } from 'lucide-react'
import type { LibraryKind } from '@shared/types'
import { Button, Input, Modal, SegmentedControl, Select, Textarea } from '../ui'
import { useLibraryStore, type WritableScope } from '../../stores/library'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorStore } from '../../stores/editor'
import { errorMessage, toast } from '../../stores/toast'
import { cn } from '../../lib/cn'
import { KIND_LABELS, generateTemplate, itemRelativePath, validateLibraryName } from './templates'
import { useFocusOnMount } from '../settings/controls'

export interface NewSkillDialogProps {
  open: boolean
  onClose(): void
  initialKind?: LibraryKind
  initialScope?: WritableScope
}

const KIND_HELP: Record<LibraryKind, string> = {
  skill: 'A reusable workflow ATOM loads automatically when the description matches the task.',
  agent: 'A specialist with its own prompt, tools and model that ATOM can delegate tasks to.',
  command: 'A reusable prompt you run by typing /name in the chat. $ARGUMENTS is replaced with your input.'
}

const DESCRIPTION_PLACEHOLDER: Record<LibraryKind, string> = {
  skill: 'Use when reviewing REST API changes — checks naming, status codes, pagination and error shapes.',
  agent: 'Use this agent to audit database queries for N+1 problems and missing indexes.',
  command: 'Write unit tests for the given file or function'
}

/** Create a new skill / subagent / slash command from a high-quality template, then open it in the editor. */
export function NewSkillDialog({ open, onClose, initialKind = 'skill', initialScope = 'user' }: NewSkillDialogProps) {
  if (!open) return null
  return <NewSkillDialogInner onClose={onClose} initialKind={initialKind} initialScope={initialScope} />
}

function NewSkillDialogInner({ onClose, initialKind, initialScope }: { onClose(): void; initialKind: LibraryKind; initialScope: WritableScope }) {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const index = useLibraryStore((s) => s.index)
  const createItem = useLibraryStore((s) => s.createItem)
  const [kind, setKind] = useState<LibraryKind>(initialKind)
  const [scope, setScope] = useState<WritableScope>(initialScope === 'project' && !workspace ? 'user' : initialScope)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tools, setTools] = useState('')
  const [model, setModel] = useState('inherit')
  const [argumentHint, setArgumentHint] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const nameRef = useFocusOnMount<HTMLInputElement>()

  useEffect(() => {
    if (scope === 'project' && !workspace) setScope('user')
  }, [scope, workspace])

  const existing = useMemo(() => {
    const list = kind === 'skill' ? (index?.skills ?? []) : kind === 'agent' ? (index?.agents ?? []) : (index?.commands ?? [])
    return new Set(list.filter((i) => i.scope === scope).map((i) => i.name))
  }, [index, kind, scope])

  const nameError = validateLibraryName(name) ?? (existing.has(name) ? `A ${KIND_LABELS[kind].singular.toLowerCase()} named “${name}” already exists in this scope.` : null)
  const descError = kind !== 'command' && !description.trim() ? 'A description is required — it is how ATOM decides when to use it.' : null
  const content = generateTemplate(kind, { name: name || 'my-' + kind, description, tools, model, argumentHint })
  const root = scope === 'user' ? '~/.claude' : `${workspace?.name ?? '<project>'}/.claude`

  const create = async (): Promise<void> => {
    setTouched(true)
    if (nameError || descError || busy) return
    setBusy(true)
    try {
      const path = await createItem(kind, scope, name, content)
      toast.success(`${KIND_LABELS[kind].singular} “${name}” created`, 'Opened in the editor — refine the template, then save.')
      onClose()
      await useEditorStore.getState().openFile(path)
    } catch (err) {
      toast.error(`Could not create ${KIND_LABELS[kind].singular.toLowerCase()}`, errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-xl"
      title={`New ${KIND_LABELS[kind].singular.toLowerCase()}`}
      description={KIND_HELP[kind]}
      footer={
        <>
          <div className="mr-auto truncate font-mono text-[11px] text-subtle" title={`${root}/${itemRelativePath(kind, name)}`}>
            {root}/{itemRelativePath(kind, name)}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={touched && !!(nameError || descError)} onClick={() => void create()}>
            Create & open
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Type">
            <SegmentedControl
              size="sm"
              fill
              value={kind}
              options={[
                { value: 'skill', label: 'Skill', icon: <Sparkles size={12} /> },
                { value: 'agent', label: 'Subagent', icon: <Bot size={12} /> },
                { value: 'command', label: 'Command', icon: <Slash size={12} /> }
              ]}
              onChange={setKind}
            />
          </Field>
          <Field label="Scope" hint={scope === 'user' ? 'Available in every project.' : 'Only this project — commit it to share with your team.'}>
            <SegmentedControl
              size="sm"
              fill
              value={scope}
              options={[
                { value: 'user', label: 'User', icon: <User size={12} /> },
                {
                  value: 'project',
                  label: 'Project',
                  icon: <FolderGit2 size={12} />,
                  disabled: !workspace,
                  title: workspace ? workspace.path : 'Open a folder to create project items'
                }
              ]}
              onChange={setScope}
            />
          </Field>
        </div>

        <Field label="Name" error={(touched || name) && nameError ? nameError : null} hint={kind === 'command' ? `Run it as /${name || 'name'} in the chat.` : 'kebab-case, e.g. api-review'}>
          <Input
            ref={nameRef}
            inputSize="sm"
            className="font-mono"
            placeholder={kind === 'command' ? 'write-tests' : kind === 'agent' ? 'query-auditor' : 'api-review'}
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
                  .toLowerCase()
                  .replace(/[\s_]+/g, '-')
                  .replace(/[^a-z0-9-]/g, '')
              )
            }
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
        </Field>

        <Field
          label="Description"
          error={touched && descError ? descError : null}
          hint={kind === 'skill' ? 'Describe WHEN to use it — ATOM matches this text against the task to decide whether to load the skill.' : kind === 'agent' ? 'Describe when the main agent should delegate to it.' : 'Shown in the / menu.'}
        >
          <Textarea rows={2} placeholder={DESCRIPTION_PLACEHOLDER[kind]} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        {kind === 'agent' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_160px]">
            <Field label="Tools" hint="Comma separated. Leave empty to inherit all tools.">
              <Input inputSize="sm" className="font-mono" placeholder="Read, Grep, Glob, Bash" value={tools} onChange={(e) => setTools(e.target.value)} />
            </Field>
            <Field label="Model">
              <Select
                selectSize="sm"
                value={model}
                options={[
                  { value: 'inherit', label: 'Inherit' },
                  { value: 'sonnet', label: 'Sonnet' },
                  { value: 'opus', label: 'Opus' },
                  { value: 'haiku', label: 'Haiku' }
                ]}
                onChange={setModel}
              />
            </Field>
          </div>
        )}

        {kind === 'command' && (
          <Field label="Argument hint" hint="Shown after the command name while typing, e.g. [file or function].">
            <Input inputSize="sm" className="font-mono" placeholder="[file or area]" value={argumentHint} onChange={(e) => setArgumentHint(e.target.value)} />
          </Field>
        )}

        <div className="overflow-hidden rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="flex w-full items-center gap-1.5 bg-panel px-3 py-1.5 text-left text-[11.5px] text-muted hover:text-fg"
          >
            <ChevronDown size={12} className={cn('transition-transform', !showPreview && '-rotate-90')} />
            Template preview
            <span className="ml-auto text-subtle">You can edit everything after it opens</span>
          </button>
          {showPreview && <pre className="selectable max-h-[260px] overflow-auto border-t border-line bg-input px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted">{content}</pre>}
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="text-[12px] font-medium text-fg">{label}</div>
      {children}
      {error ? <div className="text-[11px] text-danger">{error}</div> : hint && <div className="text-[11px] leading-relaxed text-subtle">{hint}</div>}
    </div>
  )
}
