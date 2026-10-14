import { atom } from './api'

export const isMac = atom.platform === 'darwin'
export const isWindows = atom.platform === 'win32'

/** Human-readable modifier label for shortcut hints. */
export const modKey = isMac ? '⌘' : 'Ctrl'

/** Format a keybinding like "mod+shift+p" for display, e.g. "⌘⇧P" or "Ctrl+Shift+P". */
export function formatKeybinding(binding: string): string {
  const parts = binding.split('+').map((p) => p.trim().toLowerCase())
  const map: Record<string, string> = isMac
    ? { mod: '⌘', ctrl: '⌃', shift: '⇧', alt: '⌥', enter: '↩', escape: 'Esc', backspace: '⌫', tab: '⇥', up: '↑', down: '↓', left: '←', right: '→' }
    : { mod: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', enter: 'Enter', escape: 'Esc', backspace: 'Backspace', tab: 'Tab', up: '↑', down: '↓', left: '←', right: '→' }
  const out = parts.map((p) => map[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
  return isMac ? out.join('') : out.join('+')
}
