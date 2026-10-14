/**
 * Slash commands handled by ATOM Code itself (never sent to the agent): /new, /clear, /mode, /model, /help.
 * Everything else that starts with "/" is sent as-is — the CLI runs the command or skill.
 */
import { FALLBACK_MODELS, getAllModes, normalizeModelValue } from '@shared/modes'
import { usePickerStore } from '../../../lib/agent-commands'
import { addNotice } from '../../../lib/agent-reducer'
import { formatKeybinding } from '../../../lib/platform'
import { useAgentStore } from '../../../stores/agent'
import { useSettingsStore } from '../../../stores/settings'
import { toast } from '../../../stores/toast'

function helpMarkdown(): string {
  const k = formatKeybinding
  return [
    '**Keyboard**',
    `- \`Enter\` send · \`${k('shift+enter')}\` new line · \`Esc\` stop ATOM while it works`,
    `- \`${k('shift+tab')}\` cycle modes · \`${k('mod+.')}\` mode picker · \`${k('mod+/')}\` model picker`,
    '- `↑` in an empty input recalls your previous messages · `Tab` accepts the suggested prompt',
    `- \`${k('mod+l')}\` add the editor selection · \`${k('mod+k')}\` inline edit in the editor · \`${k('mod+shift+l')}\` new chat`,
    '',
    '**Context**',
    '- Type `@` to attach files, folders, the current file, your selection, terminal output, problems or the git diff',
    '- Paste or drop images (PNG, JPEG, GIF, WebP — large ones are downscaled automatically) and drag files from the Explorer',
    '',
    '**Commands**',
    '- `/new` or `/clear` start a fresh chat · `/mode <id>` · `/model <id>` · `/compact` summarize the conversation',
    '- `/atom:…` ATOM’s bundled commands and skills — review, test, commit, plan, explain, fix and more'
  ].join('\n')
}

export function showHelpNotice(chatId: string): void {
  useAgentStore.setState((s) => {
    const chat = s.chats[chatId]
    if (!chat) return s
    return { chats: { ...s.chats, [chatId]: addNotice(chat, { variant: 'info', text: 'ATOM Code — shortcuts & commands', detail: helpMarkdown(), detailMarkdown: true }) } }
  })
}

/** Switch mode by id or name (case-insensitive). Returns false when no mode matches. */
export function switchModeByName(chatId: string, name: string): boolean {
  const q = name.trim().toLowerCase()
  const mode = getAllModes(useSettingsStore.getState().settings.customModes).find((m) => m.id.toLowerCase() === q || m.name.toLowerCase() === q)
  if (!mode) return false
  useAgentStore.getState().setMode(mode.id, chatId)
  return true
}

/** Switch model by value, alias or label (case-insensitive; "default" = the account default). */
export function switchModelByName(chatId: string, name: string): boolean {
  const q = name.trim().toLowerCase()
  const caps = useAgentStore.getState().chats[chatId]?.capabilities?.models
  const models = caps?.length ? caps : FALLBACK_MODELS
  const match = models.find((m) => (m.value || 'default').toLowerCase() === q || m.label.toLowerCase() === q)
  // Unknown ids are passed through: the CLI accepts full model ids and aliases it knows about.
  useAgentStore.getState().setModel(match ? match.value : normalizeModelValue(q === 'default' ? '' : name.trim()), chatId)
  return true
}

/** Run a local command. Returns true when `input` was handled (the composer is then cleared). */
export function runLocalCommand(chatId: string, input: string): boolean {
  const text = input.trim()
  const store = useAgentStore.getState()
  const chat = store.chats[chatId]
  if (!chat) return false

  if (text === '/new' || text === '/clear') {
    store.clearComposer(chatId)
    store.newChat({ modeId: chat.modeId })
    store.focusComposer()
    return true
  }
  if (text === '/help') {
    store.setComposerText('', chatId)
    showHelpNotice(chatId)
    return true
  }
  const mode = /^\/mode(?:\s+(\S+))?$/.exec(text)
  if (mode) {
    if (!mode[1]) {
      store.setComposerText('', chatId)
      usePickerStore.getState().openPicker('mode')
      return true
    }
    if (switchModeByName(chatId, mode[1])) store.setComposerText('', chatId)
    else toast.warning(`Unknown mode “${mode[1]}”`, `Available: ${getAllModes(useSettingsStore.getState().settings.customModes).map((m) => m.id).join(', ')}`)
    return true
  }
  const model = /^\/model(?:\s+(\S+))?$/.exec(text)
  if (model) {
    if (!model[1]) {
      store.setComposerText('', chatId)
      usePickerStore.getState().openPicker('model')
      return true
    }
    switchModelByName(chatId, model[1])
    store.setComposerText('', chatId)
    return true
  }
  return false
}
