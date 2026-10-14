/**
 * Confirmations before ATOM work in progress is stopped: closing a chat tab (tab X, middle-click, header menu,
 * command palette) and leaving the workspace (opening another folder, closing the folder or the window), which
 * closes every chat's CLI session.
 */
import { confirmDialog } from '../components/ui/ConfirmDialog'
import { useAgentStore } from '../stores/agent'
import { isRunning } from './agent-reducer'
import type { ChatState } from './agent-types'

/** A turn is in progress, or the agent is blocked on a permission / plan / question prompt. */
export function isChatBusy(chat: Pick<ChatState, 'status' | 'pendingRequests'>): boolean {
  return isRunning(chat) || chat.pendingRequests.length > 0
}

/** Number of open chats that would be interrupted by closing them. */
export function busyChatCount(): number {
  const s = useAgentStore.getState()
  return s.order.reduce((n, id) => (s.chats[id] && isChatBusy(s.chats[id]) ? n + 1 : n), 0)
}

/** Close a chat tab; asks first when a turn is still running. */
export async function closeChatTab(id: string): Promise<void> {
  const chat = useAgentStore.getState().chats[id]
  if (!chat) return
  if (isChatBusy(chat)) {
    const ok = await confirmDialog({
      title: 'Stop and close this chat?',
      message: 'ATOM is still working in this chat. Closing it stops the current turn — you can reopen the conversation later from the history.',
      confirmLabel: 'Stop & close',
      danger: true
    })
    if (!ok) return
  }
  useAgentStore.getState().closeChat(id)
}

export type LeaveWorkspaceAction = 'open-folder' | 'close-folder' | 'close-window'

const LEAVE_COPY: Record<LeaveWorkspaceAction, { verb: string; confirmLabel: string }> = {
  'open-folder': { verb: 'Opening another folder', confirmLabel: 'Stop & open' },
  'close-folder': { verb: 'Closing the folder', confirmLabel: 'Stop & close' },
  'close-window': { verb: 'Closing the window', confirmLabel: 'Stop & close' }
}

/**
 * Before the workspace changes (every chat's CLI session is closed then): when a chat is still working or
 * waiting for an answer, ask the user. Resolves true when it is fine to continue.
 */
export async function confirmStopRunningChats(action: LeaveWorkspaceAction): Promise<boolean> {
  const n = busyChatCount()
  if (!n) return true
  const copy = LEAVE_COPY[action]
  return confirmDialog({
    title: n === 1 ? 'Stop the running chat?' : `Stop ${n} running chats?`,
    message: `ATOM is still working${n === 1 ? ' in a chat' : ` in ${n} chats`}. ${copy.verb} stops ${n === 1 ? 'it' : 'them'} — unfinished edits stay as they are, and you can reopen the conversations later from the history.`,
    confirmLabel: copy.confirmLabel,
    danger: true
  })
}
