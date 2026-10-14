import { useMemo, useState, type KeyboardEvent } from 'react'
import { Bot, ExternalLink, Globe, ListChecks, Pencil, SendHorizontal, ShieldQuestion, Sparkles, TriangleAlert } from 'lucide-react'
import { basename } from '@shared/paths'
import type { PermissionPolicy, PermissionRequest } from '@shared/types'
import { atom } from '../../../lib/api'
import { cn } from '../../../lib/cn'
import { useAgentStore } from '../../../stores/agent'
import { Badge, Button, Kbd, Textarea } from '../../ui'
import { useTranscript } from './context'
import { editsFromInput, hunksFromEdits, hunksFromStrings } from './diff'
import { DiffView } from './DiffView'
import { displayPath } from './file-links'
import { firstLine, hostOf, isObj, prettyJson, str, truncate } from './format'
import { Markdown } from './Markdown'
import { PendingShell, isTypingTarget, useCardFocus, useResponder } from './PendingShell'
import { QuestionCard } from './QuestionCard'
import { lineOffsetOf, useFileContent } from './tools/FileTools'
import { parseMcpName } from './tools/MiscTools'
import { OutputBlock, PathChip } from './ToolShell'

const EMPTY: PermissionRequest[] = []

// ─────────────────────────────────────────────────────────────────────────────
// Permission card
// ─────────────────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<string, string> = {
  acceptEdits: 'auto-accept edits',
  default: 'ask before changes',
  plan: 'plan mode',
  auto: 'auto mode',
  bypassPermissions: 'full auto',
  dontAsk: 'don’t ask'
}

/** Human readable descriptions of the SDK's PermissionUpdate suggestions ("Bash(npm test:*)", …). */
export function describeSuggestions(suggestions: unknown[] | undefined): string[] {
  const out: string[] = []
  for (const s of suggestions ?? []) {
    if (!isObj(s)) continue
    if ((s.type === 'addRules' || s.type === 'replaceRules') && Array.isArray(s.rules)) {
      for (const r of s.rules) {
        if (!isObj(r)) continue
        const tool = str(r.toolName) ?? 'tool'
        const content = str(r.ruleContent)
        out.push(content ? `${tool}(${content})` : tool)
      }
    } else if (s.type === 'setMode') {
      out.push(`switch to ${MODE_LABELS[str(s.mode) ?? ''] ?? str(s.mode) ?? 'another'} mode`)
    } else if (s.type === 'addDirectories' && Array.isArray(s.directories)) {
      out.push(`access to ${s.directories.filter((d): d is string => typeof d === 'string').join(', ')}`)
    }
  }
  return out
}

function permissionSentence(req: PermissionRequest): string {
  if (req.title) return req.title.replace(/^Claude\b/, 'ATOM')
  const i = req.input
  const file = str(i.file_path) ?? str(i.notebook_path) ?? str(i.path)
  const name = file ? basename(file) : 'this file'
  switch (req.toolName) {
    case 'Bash':
    case 'PowerShell':
      return 'Allow ATOM to run this command?'
    case 'Edit':
    case 'MultiEdit':
      return `Allow ATOM to edit ${name}?`
    case 'Write':
      return `Allow ATOM to write ${name}?`
    case 'NotebookEdit':
      return `Allow ATOM to edit the notebook ${name}?`
    case 'Read':
      return `Allow ATOM to read ${name}?`
    case 'WebFetch':
      return `Allow ATOM to fetch ${hostOf(str(i.url) ?? 'this page')}?`
    case 'WebSearch':
      return 'Allow ATOM to search the web?'
    case 'Agent':
    case 'Task':
      return 'Allow ATOM to start a subagent?'
    case 'Skill':
      return `Allow ATOM to use the ${str(i.skill) ?? 'requested'} skill?`
    default: {
      const mcp = parseMcpName(req.toolName)
      if (mcp) return `Allow ATOM to use ${mcp.tool} from ${mcp.server}?`
      return `Allow ATOM to use ${req.displayName ?? req.toolName}?`
    }
  }
}

function CommandPreview({ command, description }: { command: string; description?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-input">
      {description && <div className="border-b border-line px-2.5 py-1 text-[11.5px] text-muted">{description}</div>}
      <pre className="selectable max-h-[220px] overflow-auto whitespace-pre-wrap break-all px-2.5 py-2 font-mono text-[12px] leading-[18px] text-fg">
        <span className="select-none text-accent-2">$ </span>
        {command}
      </pre>
    </div>
  )
}

function EditPreview({ request }: { request: PermissionRequest }) {
  const path = str(request.input.file_path) ?? ''
  const isWrite = request.toolName === 'Write'
  const edits = useMemo(() => (isWrite ? [] : editsFromInput(request.toolName, request.input)), [isWrite, request.toolName, request.input])
  const current = useFileContent(path, !!path)
  const content = str(request.input.content) ?? ''
  const { hunks, offset, anchored } = useMemo(() => {
    if (isWrite) return { hunks: hunksFromStrings(typeof current === 'string' ? current : '', content), offset: 0, anchored: true }
    const off = edits.length === 1 ? lineOffsetOf(current, edits[0].oldString) : null
    return { hunks: hunksFromEdits(edits), offset: off ?? 0, anchored: off !== null }
  }, [isWrite, current, content, edits])
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex min-w-0 items-center gap-2 border-b border-line px-2 py-1">
        <PathChip path={path} full />
        {isWrite && current === null && <Badge tone="success">new file</Badge>}
        {request.toolName === 'MultiEdit' && edits.length > 1 && <span className="text-[11px] text-subtle">{edits.length} edits</span>}
      </div>
      <DiffView hunks={hunks} path={path} lineNumbers={anchored} lineOffset={offset} maxRows={18} emptyText={current === undefined ? 'Loading…' : 'No changes'} />
    </div>
  )
}

function PermissionPreview({ request }: { request: PermissionRequest }) {
  const { workspace } = useTranscript()
  const i = request.input
  switch (request.toolName) {
    case 'Bash':
    case 'PowerShell':
      return <CommandPreview command={str(i.command) ?? ''} description={str(i.description)} />
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return <EditPreview request={request} />
    case 'NotebookEdit': {
      const path = str(i.notebook_path) ?? ''
      return (
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="border-b border-line px-2 py-1">
            <PathChip path={path} full />
          </div>
          <DiffView hunks={hunksFromStrings('', str(i.new_source) ?? '')} path="cell.py" maxRows={18} />
        </div>
      )
    }
    case 'WebFetch': {
      const url = str(i.url) ?? ''
      return (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-panel px-2.5 py-2 text-[12px]">
          <button type="button" title="Open in browser" onClick={() => void atom.app.openExternal(url)} className="flex min-w-0 items-center gap-1.5 text-left text-accent hover:underline">
            <Globe size={13} className="shrink-0" />
            <span className="truncate font-mono text-[11.5px]">{url}</span>
            <ExternalLink size={11} className="shrink-0" />
          </button>
          {str(i.prompt) && <div className="italic text-muted">{truncate(str(i.prompt) ?? '', 300)}</div>}
        </div>
      )
    }
    case 'WebSearch':
      return (
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-2 text-[12px] text-fg">
          <Globe size={13} className="shrink-0 text-muted" />
          {str(i.query)}
        </div>
      )
    case 'Read':
    case 'Grep':
    case 'Glob': {
      const path = str(i.file_path) ?? str(i.path)
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px]">
          {str(i.pattern) && <span className="font-mono text-[11.5px] text-fg">{str(i.pattern)}</span>}
          {path && (request.toolName === 'Read' ? <PathChip path={path} full /> : <span className="font-mono text-[11.5px] text-muted">{displayPath(path, workspace)}</span>)}
        </div>
      )
    }
    case 'Agent':
    case 'Task':
      return (
        <div className="rounded-lg border border-line bg-panel px-2.5 py-2 text-[12px]">
          <div className="flex items-center gap-1.5 font-medium text-fg">
            <Bot size={13} className="text-accent" />
            {str(i.description) ?? 'Subagent'}
            {str(i.subagent_type) && <Badge tone="accent">{str(i.subagent_type)}</Badge>}
          </div>
          {str(i.prompt) && <div className="mt-1 line-clamp-4 whitespace-pre-wrap text-muted">{str(i.prompt)}</div>}
        </div>
      )
    case 'Skill':
      return (
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-2 text-[12px] text-fg">
          <Sparkles size={13} className="text-accent-2" />
          {str(i.skill) ?? 'skill'}
          {str(i.args) && <span className="truncate text-muted">{firstLine(str(i.args) ?? '')}</span>}
        </div>
      )
    default: {
      const mcp = parseMcpName(request.toolName)
      return (
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          {mcp && (
            <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1 text-[11px]">
              <span className="rounded bg-active px-1.5 py-px font-mono text-muted">{mcp.server}</span>
              <span className="rounded bg-accent-soft px-1.5 py-px font-mono text-accent">{mcp.tool}</span>
            </div>
          )}
          {Object.keys(i).length ? <OutputBlock text={prettyJson(i)} maxLines={14} /> : <div className="px-2.5 py-1.5 text-[11.5px] italic text-subtle">No input</div>}
        </div>
      )
    }
  }
}

function PermissionCard({ request, autoFocus }: { request: PermissionRequest; autoFocus: boolean }) {
  const { ref, armed } = useCardFocus(autoFocus)
  const [busy, respond] = useResponder(request.requestId)
  const [feedback, setFeedback] = useState('')
  const rules = describeSuggestions(request.suggestions)
  const ruleText = rules.join(', ')
  const allow = (scope: 'once' | 'session' | 'always'): void => respond({ behavior: 'allow', scope })
  const deny = (message?: string): void => respond({ behavior: 'deny', message: message?.trim() || undefined })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (isTypingTarget(e.target) && feedback) setFeedback('')
      else deny()
      return
    }
    // Buttons handle their own Enter; only the focused card itself maps Enter to "Allow".
    if (e.key === 'Enter' && e.target === e.currentTarget && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      if (armed()) allow('once')
    }
  }

  const note = request.decisionReason || request.blockedPath
  return (
    <PendingShell
      cardRef={ref}
      icon={ShieldQuestion}
      label="Permission request"
      onKeyDown={onKeyDown}
      title={permissionSentence(request)}
      subtitle={request.displayName && request.displayName !== request.toolName ? `${request.displayName} · ${request.toolName}` : request.toolName}
    >
      <div className="flex flex-col gap-2 px-3.5 pb-3">
        <PermissionPreview request={request} />
        {note && (
          <div className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2.5 py-1.5 text-[11.5px] text-warning">
            <TriangleAlert size={12} className="mt-[2px] shrink-0" />
            <span className="selectable min-w-0 break-words">
              {request.decisionReason}
              {request.decisionReason && request.blockedPath ? ' · ' : ''}
              {request.blockedPath && <span className="font-mono">{request.blockedPath}</span>}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => allow('once')} iconRight={<Kbd keys="enter" className="!border-transparent !bg-accent-fg/15 !text-accent-fg" />}>
            Allow
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !rules.length}
            onClick={() => allow('session')}
            title={rules.length ? `Allow ${ruleText} for the rest of this chat` : 'No reusable permission rule was suggested for this action'}
          >
            Allow for this chat
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !rules.length}
            onClick={() => allow('always')}
            title={rules.length ? `Always allow ${ruleText} in this project (.claude/settings.local.json)` : 'No reusable permission rule was suggested for this action'}
          >
            Always allow
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => deny()} iconRight={<Kbd keys="escape" />}>
            Deny
          </Button>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-input pl-2.5 pr-1 focus-within:border-accent">
          <Pencil size={12} className="shrink-0 text-subtle" />
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && feedback.trim()) {
                e.preventDefault()
                e.stopPropagation()
                deny(feedback)
              }
            }}
            placeholder="Tell ATOM what to do instead…"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            title="Deny and send this instruction"
            disabled={busy || !feedback.trim()}
            onClick={() => deny(feedback)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <SendHorizontal size={13} />
          </button>
        </div>
      </div>
    </PendingShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan card (ExitPlanMode)
// ─────────────────────────────────────────────────────────────────────────────

const KEEP_PLANNING_MESSAGE = 'The user wants to keep planning before any code is written. Ask what should change, or refine the plan.'

function PlanCard({ request, autoFocus }: { request: PermissionRequest; autoFocus: boolean }) {
  const { ref, armed } = useCardFocus(autoFocus)
  const [busy, respond] = useResponder(request.requestId)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const plan = str(request.input.plan)
  const approve = (next: PermissionPolicy): void => respond({ behavior: 'allow', scope: 'once', nextPermission: next })
  const keepPlanning = (): void => respond({ behavior: 'deny', message: feedback.trim() || KEEP_PLANNING_MESSAGE })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (feedbackOpen) {
        if (feedback) setFeedback('')
        else setFeedbackOpen(false)
      } else setFeedbackOpen(true)
      return
    }
    if (e.key === 'Enter' && e.target === e.currentTarget && !e.shiftKey) {
      e.preventDefault()
      if (armed()) approve('acceptEdits')
    }
  }

  return (
    <PendingShell
      cardRef={ref}
      icon={ListChecks}
      label="Plan approval"
      onKeyDown={onKeyDown}
      title="Ready to code?"
      subtitle="ATOM finished planning. Approve the plan to start implementing it."
    >
      {plan ? (
        <div className="max-h-[50vh] overflow-y-auto border-y border-line bg-panel px-4 py-3">
          <Markdown content={plan} />
        </div>
      ) : (
        <div className="border-y border-line bg-panel px-4 py-2.5 text-[12px] text-muted">The plan is in ATOM’s message above.</div>
      )}
      <div className="flex flex-col gap-2 px-3.5 py-3">
        {!feedbackOpen ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => approve('acceptEdits')} iconRight={<Kbd keys="enter" className="!border-transparent !bg-accent-fg/15 !text-accent-fg" />}>
              Approve &amp; auto-accept edits
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => approve('default')}>
              Approve, ask before edits
            </Button>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setFeedbackOpen(true)} iconRight={<Kbd keys="escape" />}>
              Keep planning
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 animate-fade-in">
            <Textarea
              autoFocus
              rows={3}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  e.stopPropagation()
                  keepPlanning()
                }
              }}
              placeholder="What should change in the plan? (optional)"
              className="resize-none text-[12.5px]"
            />
            <div className="flex items-center gap-1.5">
              <Button variant="primary" size="sm" disabled={busy} onClick={keepPlanning} iconRight={<Kbd keys="mod+enter" className="!border-transparent !bg-accent-fg/15 !text-accent-fg" />}>
                {feedback.trim() ? 'Send feedback' : 'Keep planning'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFeedbackOpen(false)}>
                Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </PendingShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────────

function PendingCard({ request, autoFocus }: { request: PermissionRequest; autoFocus: boolean }) {
  if (request.kind === 'plan') return <PlanCard request={request} autoFocus={autoFocus} />
  if (request.kind === 'question') return <QuestionCard request={request} autoFocus={autoFocus} />
  return <PermissionCard request={request} autoFocus={autoFocus} />
}

/** Pending permission / plan / question prompts of a chat (oldest first; the first one takes focus). */
export function PendingRequests({ chatId }: { chatId: string }) {
  const requests = useAgentStore((s) => s.chats[chatId]?.pendingRequests ?? EMPTY)
  if (!requests.length) return null
  return (
    <div className={cn('flex flex-col gap-2.5')}>
      {requests.map((r, i) => (
        <PendingCard key={r.requestId} request={r} autoFocus={i === 0} />
      ))}
    </div>
  )
}
