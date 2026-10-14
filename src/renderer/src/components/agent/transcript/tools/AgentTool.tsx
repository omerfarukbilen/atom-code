import { useState } from 'react'
import { Bot, ChevronRight, CircleStop } from 'lucide-react'
import { cn } from '../../../../lib/cn'
import type { ToolCall } from '../../../../lib/agent-types'
import { isToolActive } from '../../../../lib/agent-reducer'
import { useAgentStore } from '../../../../stores/agent'
import { Badge } from '../../../ui'
import { BlockList } from '../Blocks'
import { DepthContext, useDepth, useTranscript } from '../context'
import { arr, formatDuration, formatTokens, isObj, plural, str } from '../format'
import { Markdown } from '../Markdown'
import { DetailSection, OutputBlock, ToolAction, ToolShell } from '../ToolShell'

const RECENT_STEPS = 8

function reportText(tool: ToolCall): string | undefined {
  const s = isObj(tool.structured) ? tool.structured : null
  if (s && s.status === 'completed') {
    const text = arr(s.content)
      .map((c) => (isObj(c) && c.type === 'text' ? (str(c.text) ?? '') : ''))
      .filter(Boolean)
      .join('\n\n')
    if (text.trim()) return text
  }
  if (s && (s.status === 'async_launched' || s.status === 'remote_launched')) return undefined
  if (tool.status === 'success' && !tool.subagent?.backgrounded) return tool.result?.text || undefined
  return undefined
}

function statsLine(tool: ToolCall): string {
  const sub = tool.subagent
  const parts: string[] = []
  if (sub?.toolUses) parts.push(plural(sub.toolUses, 'tool use'))
  if (sub?.totalTokens) parts.push(`${formatTokens(sub.totalTokens)} tokens`)
  if (sub?.durationMs) parts.push(formatDuration(sub.durationMs))
  return parts.join(' · ')
}

function Steps({ tool }: { tool: ToolCall }) {
  const depth = useDepth()
  const [all, setAll] = useState(false)
  const blocks = tool.children
  if (!blocks.length) return null
  const hidden = all ? 0 : Math.max(0, blocks.length - RECENT_STEPS)
  const shown = hidden ? blocks.slice(-RECENT_STEPS) : blocks
  return (
    <DetailSection label={`Steps · ${blocks.length}`}>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="mb-1 flex items-center gap-1 text-[11px] text-accent hover:underline">
          <ChevronRight size={11} />
          Show {plural(hidden, 'earlier step')}
        </button>
      )}
      <DepthContext.Provider value={depth + 1}>
        <BlockList blocks={shown} />
      </DepthContext.Provider>
    </DetailSection>
  )
}

/** Agent / Task tool: a subagent run with live progress, nested steps and the final report. */
export function AgentTool({ tool }: { tool: ToolCall }) {
  const depth = useDepth()
  const { chatId } = useTranscript()
  const [showPrompt, setShowPrompt] = useState(false)
  const sub = tool.subagent
  const type = str(tool.input.subagent_type) ?? sub?.subagentType ?? 'general-purpose'
  const description = str(tool.input.description) ?? sub?.description ?? 'Subagent'
  const prompt = str(tool.input.prompt)
  const model = str(tool.input.model)
  const running = isToolActive(tool)
  const report = reportText(tool)
  const stats = statsLine(tool)
  const failed = sub?.status === 'failed' || tool.status === 'error'
  const stopped = sub?.status === 'stopped'
  const canStop = running && !!sub?.taskId && (sub.backgrounded || tool.status === 'running')

  let live: string
  if (running) live = sub?.summary || (sub?.lastToolName ? `Using ${sub.lastToolName}…` : sub?.backgrounded ? 'Working in the background…' : 'Starting…')
  else if (failed) live = sub?.error || 'The subagent failed'
  else if (stopped) live = 'Stopped'
  else live = stats || (tool.status === 'denied' ? 'Denied' : tool.status === 'interrupted' ? 'Interrupted' : 'Done')

  return (
    <ToolShell
      tool={tool}
      icon={Bot}
      variant="card"
      iconClassName="text-accent"
      defaultOpen={running && depth === 0}
      className={cn(running && 'shadow-glow')}
      title={
        <>
          <Badge tone="accent" className="shrink-0 font-mono">
            {type}
          </Badge>
          <span className="truncate font-medium">{description}</span>
          {model && <span className="shrink-0 text-[11px] text-subtle">{model}</span>}
        </>
      }
      meta={sub?.backgrounded && running ? <Badge tone="info">background</Badge> : undefined}
      actions={
        canStop && sub?.taskId ? (
          <ToolAction icon={CircleStop} label="Stop" title="Stop this subagent" onClick={() => void useAgentStore.getState().stopTask(sub.taskId as string, chatId)} />
        ) : undefined
      }
      preview={
        <div className="flex min-w-0 items-center gap-2 border-t border-line px-2.5 py-1 text-[11.5px]">
          <span className={cn('min-w-0 flex-1 truncate', running ? 'animate-shimmer-text' : failed ? 'text-danger' : 'text-subtle')} title={live}>
            {live}
          </span>
          {running && stats && <span className="shrink-0 text-[11px] text-subtle">{stats}</span>}
        </div>
      }
    >
      <div className="flex flex-col">
        {prompt && (
          <DetailSection>
            <button type="button" onClick={() => setShowPrompt((v) => !v)} className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-subtle hover:text-fg">
              <ChevronRight size={11} className={cn('transition-transform', showPrompt && 'rotate-90')} />
              Prompt
            </button>
            {showPrompt && <OutputBlock text={prompt} maxLines={16} tone="muted" className="-mx-2.5" />}
          </DetailSection>
        )}
        <Steps tool={tool} />
        {report && (
          <DetailSection label="Report">
            <Markdown content={report} className="!text-[12.5px]" />
          </DetailSection>
        )}
        {!report && !tool.children.length && !prompt && (
          <div className="px-2.5 py-1.5 text-[11.5px] italic text-subtle">{running ? 'Waiting for the first step…' : 'No details'}</div>
        )}
      </div>
    </ToolShell>
  )
}
