import { create } from 'zustand'
import { isMac } from '../lib/platform'

/**
 * Global command registry. Every user-invokable action (palette entries, keyboard shortcuts, native menu
 * items) is a Command. Feature modules register their commands once at startup with `registerCommands`.
 *
 * Keybinding syntax: "mod+shift+p" — `mod` is ⌘ on macOS and Ctrl elsewhere. Chords are not supported.
 */
export interface Command {
  id: string
  title: string
  category?: string
  keybinding?: string
  /** lucide-react icon name (optional, used in the palette). */
  icon?: string
  /** Hidden from the command palette (still runnable via keybinding / executeCommand). */
  hidden?: boolean
  /** When false is returned the command is disabled (not shown, keybinding ignored). */
  when?: () => boolean
  /** When true the keybinding also fires while focus is inside Monaco / inputs. Default true for mod-combos. */
  global?: boolean
  run: () => void | Promise<void>
}

interface CommandState {
  commands: Record<string, Command>
  register(commands: Command[]): () => void
}

export const useCommandStore = create<CommandState>((set, get) => ({
  commands: {},
  register: (commands) => {
    set({ commands: { ...get().commands, ...Object.fromEntries(commands.map((c) => [c.id, c])) } })
    return () => {
      const next = { ...get().commands }
      for (const c of commands) if (next[c.id] === c) delete next[c.id]
      set({ commands: next })
    }
  }
}))

export function registerCommands(commands: Command[]): () => void {
  return useCommandStore.getState().register(commands)
}

export async function executeCommand(id: string): Promise<boolean> {
  const cmd = useCommandStore.getState().commands[id]
  if (!cmd || (cmd.when && !cmd.when())) return false
  try {
    await cmd.run()
  } catch (err) {
    console.error(`[command] ${id} failed`, err)
  }
  return true
}

export function listCommands(): Command[] {
  return Object.values(useCommandStore.getState().commands)
    .filter((c) => !c.hidden && (!c.when || c.when()))
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.title.localeCompare(b.title))
}

function normalizeKey(key: string): string {
  const k = key.toLowerCase()
  if (k === ' ') return 'space'
  if (k === 'arrowup') return 'up'
  if (k === 'arrowdown') return 'down'
  if (k === 'arrowleft') return 'left'
  if (k === 'arrowright') return 'right'
  if (k === 'esc') return 'escape'
  return k
}

/** True when the keyboard event matches a binding like "mod+shift+p". */
export function matchesKeybinding(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const wantMod = parts.includes('mod')
  const wantCtrl = parts.includes('ctrl')
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')
  const modPressed = isMac ? e.metaKey : e.ctrlKey
  const ctrlPressed = isMac ? e.ctrlKey : false
  if (wantMod !== modPressed) return false
  if (isMac && wantCtrl !== ctrlPressed) return false
  if (wantShift !== e.shiftKey) return false
  if (wantAlt !== e.altKey) return false
  // Use `code` for letters/digits so Shift/Alt layouts still match (e.g. Alt+B on macOS gives "∫").
  const code = e.code.toLowerCase()
  const fromCode = code.startsWith('key') ? code.slice(3) : code.startsWith('digit') ? code.slice(5) : null
  const pressed = fromCode ?? normalizeKey(e.key)
  if (key === ',' && (e.key === ',' || code === 'comma')) return true
  if (key === '`' && (e.key === '`' || code === 'backquote')) return true
  if (key === '\\' && code === 'backslash') return true
  return pressed === key || normalizeKey(e.key) === key
}

/** Installs the global keydown listener. Call once from the app root. */
export function installKeybindings(): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return
    const commands = Object.values(useCommandStore.getState().commands)
    for (const cmd of commands) {
      if (!cmd.keybinding) continue
      if (!matchesKeybinding(e, cmd.keybinding)) continue
      if (cmd.when && !cmd.when()) continue
      const target = e.target as HTMLElement | null
      const inEditable =
        !!target && (target.closest('.monaco-editor') || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const hasModifier = cmd.keybinding.includes('mod') || cmd.keybinding.includes('ctrl') || cmd.keybinding.includes('alt')
      const global = cmd.global ?? hasModifier
      if (inEditable && !global) continue
      e.preventDefault()
      e.stopPropagation()
      void executeCommand(cmd.id)
      return
    }
  }
  window.addEventListener('keydown', handler, true)
  return () => window.removeEventListener('keydown', handler, true)
}
