import { useMemo } from 'react'
import {
  Circle,
  CircleCheckBig,
  CircleDot,
  ClipboardList,
  ListChecks,
  ListTodo,
  MessageCircleQuestion,
  Plug,
  Sparkles,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { cn } from '../../../../lib/cn'
import type { TodoItem, ToolCall } from '../../../../lib/agent-types'
import { Badge } from '../../../ui'
import { useDepth } from '../context'
import { arr, firstLine, isObj, num, plural, prettyJson, str, truncate } from '../format'
import { Markdown } from '../Markdown'
import { DetailSection, JsonSection, Mono, OutputBlock, PathChip, ToolShell } from '../ToolShell'

// ─────────────────────────────────────────────────────────────────────────────
// Todos
// ─────────────────────────────────────────────────────────────────────────────

export function parseTodos(v: unknown): TodoItem[] {
  return arr(v)
    .filter(isObj)
    .map((t): TodoItem => {
      const status = t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending'
      return { content: str(t.content) ?? str(t.subject) ?? '', status, activeForm: str(t.activeForm) }
    })
    .filter((t) => t.content)
}

export function TodoStatusIcon({ status, size = 13 }: { status: TodoItem['status']; size?: number }) {
  if (status === 'completed') return <CircleCheckBig size={size} className="shrink-0 text-success" />
  if (status === 'in_progress') return <CircleDot size={size} className="shrink-0 text-accent" />
  return <Circle size={size} className="shrink-0 text-subtle" />
}

/** Read-only checklist (tool details and the todo strip). */
export function TodoChecklist({ todos, className }: { todos: TodoItem[]; className?: string }) {
  return (
    <ul className={cn('flex flex-col gap-0.5', className)}>
      {todos.map((t, i) => (
        <li key={t.id ?? i} className="flex items-start gap-2 text-[12px] leading-[18px]">
          <span className="mt-[2px]">
            <TodoStatusIcon status={t.status} />
          </span>
          <span
            className={cn(
              'min-w-0 flex-1 break-words',
              t.status === 'completed' && 'text-subtle line-through decoration-line-strong',
              t.status === 'in_progress' && 'font-medium text-fg',
              t.status === 'pending' && 'text-muted'
            )}
          >
            {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TodoTool({ tool }: { tool: ToolCall }) {
  const todos = useMemo(() => parseTodos(tool.input.todos), [tool.input.todos])
  const done = todos.filter((t) => t.status === 'completed').length
  const current = todos.find((t) => t.status === 'in_progress')
  return (
    <ToolShell
      tool={tool}
      icon={ListTodo}
      title={
        <>
          <span className="shrink-0">Updated todos</span>
          {todos.length > 0 && (
            <span className="shrink-0 tabular-nums text-[11px] text-subtle">
              {done}/{todos.length}
            </span>
          )}
          {current && <span className="truncate text-subtle">· {current.activeForm || current.content}</span>}
        </>
      }
    >
      {todos.length ? <TodoChecklist todos={todos} className="px-2.5 py-2" /> : undefined}
    </ToolShell>
  )
}

export function TaskTool({ tool }: { tool: ToolCall }) {
  const input = tool.input
  const s = isObj(tool.structured) ? tool.structured : null
  const taskId = str(input.taskId) ?? (num(input.taskId) !== undefined ? String(num(input.taskId)) : undefined) ?? str(input.task_id)
  let title: TaskTitle
  switch (tool.name) {
    case 'TaskCreate':
      title = { verb: 'Created task', detail: str(input.subject) ?? '' }
      break
    case 'TaskUpdate': {
      const status = str(input.status)
      title = {
        verb: `Updated task${taskId ? ` #${taskId}` : ''}`,
        detail: [str(input.subject), status ? `→ ${status.replace('_', ' ')}` : ''].filter(Boolean).join(' '),
        status: status === 'completed' || status === 'in_progress' || status === 'pending' ? status : undefined
      }
      break
    }
    case 'TaskList': {
      const n = s ? arr(s.tasks).length : undefined
      title = { verb: 'Listed tasks', detail: n !== undefined ? plural(n, 'task') : '' }
      break
    }
    case 'TaskGet':
      title = { verb: `Viewed task${taskId ? ` #${taskId}` : ''}`, detail: '' }
      break
    default:
      title = { verb: 'Stopped task', detail: taskId ?? str(input.shell_id) ?? '' }
  }
  return (
    <ToolShell
      tool={tool}
      icon={ClipboardList}
      title={
        <>
          <span className="shrink-0">{title.verb}</span>
          {title.status && <TodoStatusIcon status={title.status} size={12} />}
          {title.detail && <span className="truncate text-subtle">{title.detail}</span>}
        </>
      }
    />
  )
}

interface TaskTitle {
  verb: string
  detail: string
  status?: TodoItem['status']
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill
// ─────────────────────────────────────────────────────────────────────────────

export function SkillTool({ tool }: { tool: ToolCall }) {
  const name = str(tool.input.skill) ?? str(tool.input.name) ?? str(tool.input.command) ?? 'skill'
  const args = str(tool.input.args) ?? str(tool.input.arguments)
  return (
    <ToolShell
      tool={tool}
      icon={Sparkles}
      iconClassName="!text-accent-2"
      title={
        <>
          <span className="shrink-0">Using skill</span>
          <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-accent-soft px-1.5 py-px text-[11.5px] font-medium text-accent">
            <Sparkles size={11} className="shrink-0" />
            <span className="truncate">{name}</span>
          </span>
          {args && <span className="truncate text-subtle">{truncate(firstLine(args), 80)}</span>}
        </>
      }
    >
      {args && args.length > 80 ? <OutputBlock text={args} tone="muted" maxLines={12} /> : undefined}
    </ToolShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ExitPlanMode / AskUserQuestion (resolved, compact — the interactive versions are pending cards)
// ─────────────────────────────────────────────────────────────────────────────

export function PlanTool({ tool }: { tool: ToolCall }) {
  const s = isObj(tool.structured) ? tool.structured : null
  const plan = str(tool.input.plan) ?? (s ? str(s.plan) : undefined)
  const filePath = s ? str(s.filePath) : undefined
  const title =
    tool.status === 'success'
      ? 'Plan approved'
      : tool.status === 'denied'
        ? 'Plan sent back for changes'
        : tool.status === 'interrupted'
          ? 'Plan review interrupted'
          : tool.status === 'error'
            ? 'Plan'
            : 'Plan ready for review'
  return (
    <ToolShell
      tool={tool}
      icon={ListChecks}
      variant="card"
      iconClassName={tool.status === 'success' ? 'text-success' : undefined}
      title={
        <>
          <span className="shrink-0 font-medium">{title}</span>
          {filePath && <PathChip path={filePath} />}
        </>
      }
    >
      {plan ? (
        <div className="max-h-[420px] overflow-y-auto px-3 py-2">
          <Markdown content={plan} className="!text-[12.5px]" />
        </div>
      ) : undefined}
    </ToolShell>
  )
}

interface QuestionSpec {
  question: string
  header: string
}

function stringRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (isObj(v)) for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val
  return out
}

function parseAnswersFromText(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!text) return out
  const re = /"([^"]+)"="([^"]*)"/g
  for (let m = re.exec(text); m; m = re.exec(text)) out[m[1]] = m[2]
  return out
}

export function QuestionTool({ tool }: { tool: ToolCall }) {
  const depth = useDepth()
  const questions: QuestionSpec[] = arr(tool.input.questions)
    .filter(isObj)
    .map((q) => ({ question: str(q.question) ?? '', header: str(q.header) ?? '' }))
    .filter((q) => q.question)
  const s = isObj(tool.structured) ? tool.structured : null
  const answers: Record<string, string> = {
    ...parseAnswersFromText(tool.result?.text),
    ...stringRecord(tool.input.answers),
    ...stringRecord(s?.answers)
  }
  const answered = questions.filter((q) => typeof answers[q.question] === 'string').length
  return (
    <ToolShell
      tool={tool}
      icon={MessageCircleQuestion}
      defaultOpen={depth === 0 && answered > 0}
      title={
        <>
          <span className="shrink-0">{questions.length > 1 ? `Asked ${questions.length} questions` : 'Asked a question'}</span>
          {questions.length === 1 && <span className="truncate text-subtle">{questions[0].question}</span>}
          {tool.status === 'success' && answered > 0 && <span className="shrink-0 text-[11px] text-success">answered</span>}
          {tool.status === 'denied' && <span className="shrink-0 text-[11px] text-warning">skipped</span>}
        </>
      }
    >
      {questions.length ? (
        <div className="flex flex-col gap-2 px-2.5 py-2">
          {questions.map((q) => (
            <div key={q.question} className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                {q.header && <Badge tone="neutral">{q.header}</Badge>}
                <span className="min-w-0 break-words">{q.question}</span>
              </div>
              <div className={cn('mt-0.5 pl-1 text-[12.5px]', answers[q.question] ? 'font-medium text-fg' : 'italic text-subtle')}>
                {answers[q.question] ? `→ ${answers[q.question]}` : 'No answer'}
              </div>
            </div>
          ))}
        </div>
      ) : undefined}
    </ToolShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP tools
// ─────────────────────────────────────────────────────────────────────────────

export function parseMcpName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? { server: m[1], tool: m[2] } : null
}

const IDE_TOOL_LABELS: Record<string, string> = {
  get_open_editors: 'Checked open editors',
  get_diagnostics: 'Checked problems',
  get_selection: 'Read the editor selection',
  get_terminal_output: 'Read terminal output',
  open_file: 'Opened'
}

function Chip({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-px font-mono text-[11px]',
        tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-active text-muted'
      )}
    >
      {children}
    </span>
  )
}

export function McpTool({ tool }: { tool: ToolCall }) {
  const parsed = parseMcpName(tool.name)
  const server = parsed?.server ?? 'mcp'
  const name = parsed?.tool ?? tool.name
  const isIde = server === 'atom-ide'
  const ideLabel = isIde ? IDE_TOOL_LABELS[name] : undefined
  const path = str(tool.input.path)
  const output = tool.result && !tool.result.isError ? tool.result.text : ''
  const hasInput = Object.keys(tool.input).length > 0
  return (
    <ToolShell
      tool={tool}
      icon={Plug}
      title={
        ideLabel ? (
          <>
            <span className="shrink-0">{ideLabel}</span>
            {path && <PathChip path={path} line={num(tool.input.line)} />}
          </>
        ) : (
          <>
            <Chip>{server}</Chip>
            <Chip tone="accent">{name}</Chip>
            {hasInput && <Mono className="text-subtle">{truncate(firstLine(Object.values(tool.input).filter((v) => typeof v === 'string').join(' ')), 60)}</Mono>}
          </>
        )
      }
    >
      {hasInput || output ? (
        <div className="flex flex-col">
          {hasInput && <JsonSection label="Input" value={tool.input} />}
          {output && <JsonSection label="Output" value={output} defaultOpen={!isIde} />}
        </div>
      ) : undefined}
    </ToolShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic fallback
// ─────────────────────────────────────────────────────────────────────────────

const FRIENDLY: Record<string, { label: string; icon?: LucideIcon }> = {
  EnterPlanMode: { label: 'Entered plan mode', icon: ListChecks },
  TaskOutput: { label: 'Read background task output' },
  BashOutput: { label: 'Read background command output' },
  KillShell: { label: 'Stopped background command' },
  ListMcpResourcesTool: { label: 'Listed MCP resources', icon: Plug },
  ReadMcpResourceTool: { label: 'Read MCP resource', icon: Plug },
  EnterWorktree: { label: 'Entered worktree' },
  ExitWorktree: { label: 'Left worktree' },
  LS: { label: 'Listed directory' }
}

export function GenericTool({ tool }: { tool: ToolCall }) {
  const friendly = FRIENDLY[tool.name]
  const firstString = Object.values(tool.input).find((v): v is string => typeof v === 'string' && v.trim().length > 0)
  const output = tool.result && !tool.result.isError ? tool.result.text : ''
  const hasInput = Object.keys(tool.input).length > 0
  return (
    <ToolShell
      tool={tool}
      icon={friendly?.icon ?? Wrench}
      title={
        <>
          <span className="shrink-0">{friendly?.label ?? tool.name}</span>
          {firstString && <Mono className="text-subtle">{truncate(firstLine(firstString), 70)}</Mono>}
        </>
      }
    >
      {hasInput || output ? (
        <div className="flex flex-col">
          {hasInput && <JsonSection label="Input" value={tool.input} />}
          {output && (
            <DetailSection label="Output" className="!px-0">
              <OutputBlock text={prettyJson(output)} maxLines={20} />
            </DetailSection>
          )}
        </div>
      ) : undefined}
    </ToolShell>
  )
}
