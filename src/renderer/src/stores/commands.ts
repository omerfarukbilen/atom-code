import { create } from 'zustand'
import { isMac, isWindows } from '../lib/platform'
import { matchesChord, matchesKeybindingOn, type KeyPlatform } from '../components/workbench/keybinding-match'

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
  /**
   * When true, the keystroke is left to the shell if it is pressed with the physical Ctrl key while an
   * integrated terminal has focus (readline / fzf / nano keys such as Ctrl+G, Ctrl+N, Ctrl+O). The command
   * still runs from the palette and the native menu.
   */
  terminalPassthrough?: boolean
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

const PLATFORM: KeyPlatform = isMac ? 'mac' : isWindows ? 'windows' : 'linux'

/** True when the keyboard event matches a binding like "mod+shift+p" (layout-aware, AltGr-safe). */
export function matchesKeybinding(e: KeyboardEvent, binding: string): boolean {
  return matchesKeybindingOn(e, binding, PLATFORM)
}

/** Keys the focused widget handles itself, e.g. `data-keys-passthrough="ctrl+n ctrl+p"` on the palette input. */
function isPassthroughKey(e: KeyboardEvent, target: HTMLElement | null): boolean {
  const chords = target?.closest?.('[data-keys-passthrough]')?.getAttribute('data-keys-passthrough')
  return !!chords && chords.split(/\s+/).some((chord) => chord && matchesChord(e, chord))
}

/** Installs the global keydown listener. Call once from the app root. */
export function installKeybindings(): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return
    const target = e.target instanceof HTMLElement ? e.target : null
    if (isPassthroughKey(e, target)) return
    const inTerminal = !!target?.closest('.atom-xterm-host')
    const commands = Object.values(useCommandStore.getState().commands)
    for (const cmd of commands) {
      if (!cmd.keybinding) continue
      if (!matchesKeybinding(e, cmd.keybinding)) continue
      if (cmd.terminalPassthrough && inTerminal && e.ctrlKey) continue
      if (cmd.when && !cmd.when()) continue
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
