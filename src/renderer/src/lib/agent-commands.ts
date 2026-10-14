/**
 * Agent panel commands (palette entries, keybindings, native-menu targets) plus the tiny picker bus the
 * composer listens to (`usePickerStore`) and the transcript → Markdown export.
 *
 * `registerAgentCommands()` is idempotent; App calls it once at boot.
 */
import { create } from 'zustand'
import { BUILTIN_MODES } from '@shared/modes'
import type { ContextAttachment } from '@shared/types'
import { DEFAULT_CHAT_TITLE, isRunning, stripAtomContext } from './agent-reducer'
import type { AssistantBlock, ChatState, ToolCall } from './agent-types'
import { getActiveChat, useAgentStore } from '../stores/agent'
import { executeCommand, registerCommands, type Command } from '../stores/commands'
import { useLayoutStore } from '../stores/layout'
import { toast } from '../stores/toast'

// ─────────────────────────────────────────────────────────────────────────────
// Picker bus — commands ask the active composer to open one of its pickers
// ─────────────────────────────────────────────────────────────────────────────

export type AgentPickerKind = 'mode' | 'model' | 'effort' | 'permission'

export interface PickerRequest {
  kind: AgentPickerKind
  /** Monotonic id so the same picker can be requested twice in a row. */
  id: number
  /** Unix ms — a composer mounting shortly after the request still honours it. */
  at: number
}

interface PickerStoreState {
  request: PickerRequest | null
  /** Show the agent panel and open a picker in the active composer. */
  openPicker(kind: AgentPickerKind): void
  /** Mark a request as handled. */
  consume(id: number): void
}

let pickerSeq = 0

export const usePickerStore = create<PickerStoreState>((set, get) => ({
  request: null,
  openPicker: (kind) => {
    const layout = useLayoutStore.getState()
    if (!layout.agentVisible) layout.setAgentVisible(true)
    set({ request: { kind, id: ++pickerSeq, at: Date.now() } })
  },
  consume: (id) => {
    if (get().request?.id === id) set({ request: null })
  }
}))

// ─────────────────────────────────────────────────────────────────────────────
// Transcript export
// ─────────────────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function short(text: string, max = 120): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

function toolSummary(tool: ToolCall): string {
  const i = tool.input
  const file = str(i.file_path) || str(i.notebook_path) || str(i.path)
  switch (tool.name) {
    case 'Bash':
      return str(i.command) ? `\`${short(str(i.command), 160)}\`` : ''
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return file ? `\`${file}\`` : ''
    case 'Grep':
    case 'Glob':
      return str(i.pattern) ? `\`${short(str(i.pattern), 80)}\`${file ? ` in \`${file}\`` : ''}` : ''
    case 'WebFetch':
      return str(i.url)
    case 'WebSearch':
      return str(i.query) ? `"${short(str(i.query), 100)}"` : ''
    case 'Agent':
    case 'Task':
      return short(str(i.description) || str(i.prompt), 100)
    case 'Skill':
      return str(i.skill) || str(i.command)
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `${i.todos.length} todos` : ''
    default:
      return ''
  }
}

function attachmentLabel(a: ContextAttachment): string {
  switch (a.type) {
    case 'file':
      return `\`${a.path}\``
    case 'folder':
      return `\`${a.path}/\``
    case 'selection':
      return `\`${a.path}:${a.startLine}-${a.endLine}\``
    case 'terminal':
      return 'terminal output'
    case 'diagnostics':
      return 'problems'
    case 'git-diff':
      return 'git diff'
  }
}

function blocksToMarkdown(blocks: AssistantBlock[], out: string[]): void {
  for (const b of blocks) {
    if (b.kind === 'text') {
      if (b.text.trim()) out.push(b.text.trim(), '')
    } else if (b.kind === 'tool') {
      const summary = toolSummary(b)
      const status = b.status === 'error' ? ' (failed)' : b.status === 'denied' ? ' (denied)' : b.status === 'interrupted' ? ' (interrupted)' : ''
      out.push(`- **${b.name}**${summary ? ` ${summary}` : ''}${status}`)
      if ((b.name === 'Agent' || b.name === 'Task') && b.subagent?.summary) out.push(`  - ${short(b.subagent.summary, 200)}`)
      out.push('')
    }
  }
}

/** Render a chat transcript as GitHub-flavoured Markdown (thinking is omitted). */
export function chatToMarkdown(chat: ChatState): string {
  const out: string[] = [`# ${chat.title || DEFAULT_CHAT_TITLE}`, '', `_Exported from ATOM Code · ${new Date().toLocaleString()}_`, '']
  let lastSpeaker: 'user' | 'assistant' | null = null
  for (const item of chat.items) {
    if (item.kind === 'user') {
      out.push('## You', '')
      const text = stripAtomContext(item.text)
      if (text) out.push(text, '')
      if (item.attachments.length) out.push(`_Context: ${item.attachments.map(attachmentLabel).join(', ')}_`, '')
      if (item.imageCount) out.push(`_${item.imageCount} image${item.imageCount === 1 ? '' : 's'} attached_`, '')
      lastSpeaker = 'user'
    } else if (item.kind === 'assistant') {
      if (lastSpeaker !== 'assistant') out.push('## ATOM', '')
      blocksToMarkdown(item.blocks, out)
      lastSpeaker = 'assistant'
    } else if (item.kind === 'notice') {
      if (item.variant === 'command-output' && item.detail) out.push('```', item.detail.trim(), '```', '')
      else out.push(`_${item.text}_`, '')
    } else if (item.kind === 'result' && item.isError && item.errorText) {
      out.push(`> **Error:** ${item.errorText}`, '')
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Copy a chat (default: the active one) to the clipboard as Markdown. */
export async function copyChatTranscript(chatId?: string): Promise<void> {
  const s = useAgentStore.getState()
  const chat = chatId ? s.chats[chatId] : getActiveChat()
  if (!chat || !chat.items.length) {
    toast.info('Nothing to export yet', 'Send a message first — the transcript is exported as Markdown.')
    return
  }
  try {
    await navigator.clipboard.writeText(chatToMarkdown(chat))
    toast.success('Transcript copied', 'The conversation was copied to the clipboard as Markdown.')
  } catch {
    toast.error('Could not access the clipboard')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

const agent = () => useAgentStore.getState()
const layout = () => useLayoutStore.getState()

/** True when keyboard focus is inside Monaco — the editor keeps its own ⌘L / ⌘. / ⌘/ there. */
function monacoFocused(): boolean {
  const el = document.activeElement
  return !!el && !!el.closest('.monaco-editor')
}

function activeRunning(): boolean {
  const c = getActiveChat()
  return !!c && isRunning(c)
}

function cycleChat(step: 1 | -1): void {
  const { order, activeChatId } = agent()
  if (order.length < 2) return
  const idx = Math.max(0, order.indexOf(activeChatId ?? ''))
  const next = order[(idx + step + order.length) % order.length]
  layout().setAgentVisible(true)
  agent().setActive(next)
}

function newChat(): void {
  agent().newChat()
  agent().focusComposer()
}

function buildCommands(): Command[] {
  const modeCommands: Command[] = BUILTIN_MODES.map((mode) => ({
    id: `agent.mode.${mode.id}`,
    title: `Switch to ${mode.name} Mode`,
    category: 'Agent',
    icon: mode.icon,
    run: () => {
      agent().setMode(mode.id)
      agent().focusComposer()
    }
  }))

  return [
    { id: 'agent.newChat', title: 'New Chat', category: 'Agent', keybinding: 'mod+shift+l', icon: 'MessageSquarePlus', global: true, run: newChat },
    {
      id: 'agent.focus',
      title: 'Focus Chat Input',
      category: 'Agent',
      keybinding: 'mod+l',
      icon: 'MessageSquare',
      global: true,
      run: async () => {
        // Inside Monaco ⌘L means "add the selection to the chat" (the editor's own command).
        if (monacoFocused() && (await executeCommand('editor.addToChat'))) return
        agent().focusComposer()
      }
    },
    {
      id: 'agent.stop',
      title: 'Stop Generating',
      category: 'Agent',
      icon: 'CircleStop',
      when: activeRunning,
      run: () => agent().interrupt()
    },
    {
      id: 'agent.cycleMode',
      title: 'Cycle Agent Mode',
      category: 'Agent',
      icon: 'Layers',
      run: () => {
        layout().setAgentVisible(true)
        agent().cycleMode(1)
      }
    },
    {
      id: 'agent.modePicker',
      title: 'Choose Agent Mode…',
      category: 'Agent',
      keybinding: 'mod+.',
      icon: 'Layers',
      global: true,
      when: () => !monacoFocused(),
      run: () => usePickerStore.getState().openPicker('mode')
    },
    {
      id: 'agent.modelPicker',
      title: 'Choose Model…',
      category: 'Agent',
      keybinding: 'mod+/',
      icon: 'Brain',
      global: true,
      when: () => !monacoFocused(),
      run: () => usePickerStore.getState().openPicker('model')
    },
    { id: 'agent.effortPicker', title: 'Choose Reasoning Effort…', category: 'Agent', icon: 'Gauge', run: () => usePickerStore.getState().openPicker('effort') },
    {
      id: 'agent.permissionPicker',
      title: 'Choose Permission Mode…',
      category: 'Agent',
      icon: 'ShieldCheck',
      run: () => usePickerStore.getState().openPicker('permission')
    },
    {
      id: 'agent.closeChat',
      title: 'Close Chat',
      category: 'Agent',
      icon: 'XSquare',
      run: () => {
        const id = agent().activeChatId
        if (id) agent().closeChat(id)
      }
    },
    { id: 'agent.nextChat', title: 'Next Chat', category: 'Agent', keybinding: 'mod+alt+right', global: true, when: () => agent().order.length > 1, run: () => cycleChat(1) },
    { id: 'agent.prevChat', title: 'Previous Chat', category: 'Agent', keybinding: 'mod+alt+left', global: true, when: () => agent().order.length > 1, run: () => cycleChat(-1) },
    {
      id: 'agent.toggleMaximize',
      title: 'Toggle Maximized Agent',
      category: 'Agent',
      icon: 'Maximize2',
      run: () => layout().setAgentMaximized(!layout().agentMaximized)
    },
    {
      id: 'agent.history',
      title: 'Show Chat History',
      category: 'Agent',
      icon: 'History',
      run: () => {
        if (layout().agentMaximized) layout().setAgentMaximized(false)
        useLayoutStore.setState({ sidebarVisible: true, sidebarView: 'history' })
      }
    },
    {
      id: 'agent.exportTranscript',
      title: 'Copy Transcript as Markdown',
      category: 'Agent',
      icon: 'Copy',
      when: () => !!getActiveChat()?.items.length,
      run: () => copyChatTranscript()
    },
    {
      id: 'agent.compact',
      title: 'Compact Conversation',
      category: 'Agent',
      icon: 'ChevronsDownUp',
      when: () => {
        const c = getActiveChat()
        return !!c && c.started && !isRunning(c)
      },
      run: () => agent().send('/compact')
    },
    {
      id: 'agent.acceptSuggestion',
      title: 'Use Suggested Prompt',
      category: 'Agent',
      icon: 'Sparkles',
      when: () => !!getActiveChat()?.suggestion,
      run: () => agent().acceptSuggestion()
    },
    ...modeCommands
  ]
}

let disposeRegistered: (() => void) | null = null

/** Register the agent commands (idempotent). Returns a function that unregisters them. */
export function registerAgentCommands(): () => void {
  if (disposeRegistered) return disposeRegistered
  const dispose = registerCommands(buildCommands())
  const unregister = (): void => {
    dispose()
    if (disposeRegistered === unregister) disposeRegistered = null
  }
  disposeRegistered = unregister
  return unregister
}
