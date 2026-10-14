import { isMac } from '../../lib/platform'
import { useAgentStore } from '../../stores/agent'
import { useLayoutStore } from '../../stores/layout'
import { getTerminalSelection, isTerminalFocused } from '../../stores/terminal'

/**
 * Terminal-aware handling of ⌘L / Ctrl+L. Installed on `window` (capture) *before* the global keybinding
 * dispatcher so it runs first:
 *  - with text selected in the terminal, the selection is attached to the agent composer (like Cursor);
 *  - otherwise on Windows/Linux Ctrl+L is left to the shell (clear screen) instead of focusing the agent.
 *    The event is only marked `defaultPrevented` — the dispatcher skips such events, xterm still sees it.
 */
export function installTerminalKeyHandling(): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.code !== 'KeyL' || e.shiftKey || e.altKey) return
    const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
    if (!mod || !isTerminalFocused()) return
    const selection = getTerminalSelection()
    if (selection.trim()) {
      e.preventDefault()
      e.stopImmediatePropagation()
      useLayoutStore.getState().setAgentVisible(true)
      useAgentStore.getState().addAttachment({ type: 'terminal', text: selection })
      requestAnimationFrame(() => useAgentStore.getState().focusComposer())
      return
    }
    if (!isMac) e.preventDefault()
  }
  window.addEventListener('keydown', handler, true)
  return () => window.removeEventListener('keydown', handler, true)
}
