import { Check, Copy, GitCommitHorizontal, GitPullRequest, Terminal } from 'lucide-react'
import { atom } from '../../../../lib/api'
import { cn } from '../../../../lib/cn'
import type { ToolCall } from '../../../../lib/agent-types'
import { isToolActive } from '../../../../lib/agent-reducer'
import { Badge } from '../../../ui'
import { useCopy } from '../context'
import { firstLine, formatDuration, isObj, num, str } from '../format'
import { Mono, OutputBlock, ToolShell } from '../ToolShell'

function CommandLine({ command, wrap }: { command: string; wrap?: boolean }) {
  const [copied, copy] = useCopy()
  return (
    <div className="group/cmd flex items-start gap-2 bg-input px-2.5 py-1.5 font-mono text-[11.5px] leading-[17px]">
      <span className="select-none text-accent-2">$</span>
      <span className={cn('selectable min-w-0 flex-1 text-fg', wrap ? 'whitespace-pre-wrap break-all' : 'truncate')}>{command}</span>
      <button
        type="button"
        title={copied ? 'Copied' : 'Copy command'}
        onClick={(e) => {
          e.stopPropagation()
          copy(command)
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-subtle opacity-0 hover:text-fg group-hover/cmd:opacity-100"
      >
        {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
      </button>
    </div>
  )
}

function GitBadges({ op }: { op: Record<string, unknown> }) {
  const commit = isObj(op.commit) ? op.commit : null
  const pr = isObj(op.pr) ? op.pr : null
  const push = isObj(op.push) ? op.push : null
  const prUrl = pr ? str(pr.url) : undefined
  return (
    <>
      {commit && (
        <Badge tone="success" title={str(commit.branch) ? `on ${str(commit.branch)}` : undefined}>
          <GitCommitHorizontal size={11} />
          {str(commit.kind) ?? 'committed'} {(str(commit.sha) ?? '').slice(0, 7)}
        </Badge>
      )}
      {push && <Badge tone="info">pushed {str(push.branch) ?? ''}</Badge>}
      {pr && (
        <button
          type="button"
          title={prUrl ?? 'Pull request'}
          onClick={(e) => {
            e.stopPropagation()
            if (prUrl) void atom.app.openExternal(prUrl)
          }}
        >
          <Badge tone="accent">
            <GitPullRequest size={11} />#{num(pr.number) ?? '?'} {str(pr.action) ?? ''}
          </Badge>
        </button>
      )}
    </>
  )
}

export function BashTool({ tool }: { tool: ToolCall }) {
  const command = str(tool.input.command) ?? ''
  const description = str(tool.input.description)?.trim()
  const background = tool.input.run_in_background === true
  const s = isObj(tool.structured) ? tool.structured : null
  const stdout = s ? (str(s.stdout) ?? '') : ''
  const stderr = s ? (str(s.stderr) ?? '') : ''
  const structuredOutput = [stdout.replace(/\n+$/, ''), stderr.replace(/\n+$/, '')].filter(Boolean).join('\n')
  const output = s ? structuredOutput : (tool.result?.text ?? '')
  const bgTaskId = s ? str(s.backgroundTaskId) : undefined
  const timedOutAfter = s ? num(s.timedOutAfterMs) : undefined
  const interrupted = s?.interrupted === true
  const interpretation = s ? str(s.returnCodeInterpretation) : undefined
  const gitOp = s && isObj(s.gitOperation) ? s.gitOperation : null
  const failed = tool.status === 'error'
  const active = isToolActive(tool)
  const multiLine = command.includes('\n') || command.length > 120

  return (
    <ToolShell
      tool={tool}
      icon={Terminal}
      variant="card"
      hideError
      defaultOpen={failed}
      title={description ? <span className="truncate">{description}</span> : <Mono className="text-fg">{firstLine(command) || 'Command…'}</Mono>}
      meta={
        <>
          {gitOp && <GitBadges op={gitOp} />}
          {(background || bgTaskId) && <Badge tone="info">background</Badge>}
          {timedOutAfter !== undefined && <Badge tone="warning">timed out after {formatDuration(timedOutAfter)}</Badge>}
          {failed && <Badge tone="danger">failed</Badge>}
        </>
      }
      preview={
        description && command ? (
          <div className="border-t border-line">
            <CommandLine command={multiLine ? firstLine(command) + ' …' : command} />
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col">
        {(!description || multiLine) && command && (
          <div className="border-b border-line">
            <CommandLine command={command} wrap />
          </div>
        )}
        {output.trim() ? (
          <OutputBlock text={output} maxLines={20} tone={failed ? 'danger' : 'default'} />
        ) : (
          <div className="px-2.5 py-1.5 text-[11.5px] italic text-subtle">
            {active ? 'Running…' : tool.status === 'denied' ? (tool.result?.text ?? 'Denied') : tool.status === 'interrupted' ? 'Interrupted' : 'No output'}
          </div>
        )}
        {(interrupted || bgTaskId || interpretation) && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line px-2.5 py-1 text-[11px] text-subtle">
            {interrupted && <span className="text-warning">Command was interrupted</span>}
            {bgTaskId && <span>Running in background · task {bgTaskId}</span>}
            {interpretation && <span>{interpretation}</span>}
          </div>
        )}
      </div>
    </ToolShell>
  )
}
