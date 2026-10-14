import { memo } from 'react'
import type { ToolCall } from '../../../lib/agent-types'
import { AgentTool } from './tools/AgentTool'
import { BashTool } from './tools/BashTool'
import { EditTool, NotebookEditTool, ReadTool } from './tools/FileTools'
import { GenericTool, McpTool, PlanTool, QuestionTool, SkillTool, TaskTool, TodoTool } from './tools/MiscTools'
import { GlobTool, GrepTool, WebFetchTool, WebSearchTool } from './tools/SearchTools'

/** Tools rendered as light rows that can be folded into an "Explored …" group. */
export const EXPLORE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'web_search', 'web_fetch'])

export function isExploreTool(tool: ToolCall): boolean {
  return EXPLORE_TOOLS.has(tool.name) || (tool.name.startsWith('mcp__atom-ide__') && tool.name !== 'mcp__atom-ide__open_file')
}

/** One tool call: dispatches to a tool-specific renderer (falls back to a generic JSON view). */
export const ToolCard = memo(function ToolCard({ tool }: { tool: ToolCall }) {
  switch (tool.name) {
    case 'Read':
      return <ReadTool tool={tool} />
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return <EditTool tool={tool} />
    case 'NotebookEdit':
      return <NotebookEditTool tool={tool} />
    case 'Bash':
    case 'PowerShell':
      return <BashTool tool={tool} />
    case 'Grep':
      return <GrepTool tool={tool} />
    case 'Glob':
      return <GlobTool tool={tool} />
    case 'WebSearch':
    case 'web_search':
      return <WebSearchTool tool={tool} />
    case 'WebFetch':
    case 'web_fetch':
      return <WebFetchTool tool={tool} />
    case 'Agent':
    case 'Task':
      return <AgentTool tool={tool} />
    case 'TodoWrite':
      return <TodoTool tool={tool} />
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
    case 'TaskStop':
      return <TaskTool tool={tool} />
    case 'Skill':
      return <SkillTool tool={tool} />
    case 'ExitPlanMode':
      return <PlanTool tool={tool} />
    case 'AskUserQuestion':
      return <QuestionTool tool={tool} />
    default:
      return tool.name.startsWith('mcp__') ? <McpTool tool={tool} /> : <GenericTool tool={tool} />
  }
})
