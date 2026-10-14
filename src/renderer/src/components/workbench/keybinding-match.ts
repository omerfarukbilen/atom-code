/**
 * Pure keyboard-shortcut matching (no DOM / store dependencies, unit-tested in tests/keybindings.test.ts).
 *
 * Keybinding syntax: "mod+shift+p" — `mod` is ⌘ on macOS and Ctrl elsewhere; `ctrl` only matters on macOS.
 */

export type KeyPlatform = 'mac' | 'windows' | 'linux'

/** The subset of `KeyboardEvent` the matcher reads. */
export interface KeyEventLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  getModifierState?(key: string): boolean
}

const ASCII_ALNUM = /^[a-z0-9]$/i
const PRINTABLE_ASCII = /^[\x21-\x7e]$/

export function normalizeKey(key: string): string {
  const k = key.toLowerCase()
  if (k === ' ') return 'space'
  if (k === 'arrowup') return 'up'
  if (k === 'arrowdown') return 'down'
  if (k === 'arrowleft') return 'left'
  if (k === 'arrowright') return 'right'
  if (k === 'esc') return 'escape'
  return k
}

/** A single typed character (not a named key like "Enter", "ArrowUp" or "Dead"). */
function isCharacter(key: string): boolean {
  return [...key].length === 1 && key.trim() !== ''
}

/**
 * True when the keystroke types a character through AltGr and must reach the focused input/editor/terminal
 * instead of triggering a shortcut. Windows reports AltGr as Ctrl+Alt (older Chromium without the
 * `AltGraph` modifier state too), so Polish AltGr+S ("ś") would otherwise run a `mod+alt+s` binding and
 * Hungarian AltGr+B ("{") a `mod+alt+b` one. A chord that types nothing, or a plain ASCII letter/digit
 * (US-layout Ctrl+Alt+S), or a named key (Ctrl+Alt+Right) is still a shortcut.
 * macOS is excluded: ⌥ combos type characters too and are matched by their physical key instead.
 */
export function isAltGrCharacter(e: KeyEventLike, platform: KeyPlatform): boolean {
  if (platform === 'mac') return false
  const altGr = !!e.getModifierState?.('AltGraph') || (platform === 'windows' && e.ctrlKey && e.altKey && !e.metaKey)
  return altGr && isCharacter(e.key) && !ASCII_ALNUM.test(e.key)
}

/**
 * Key names a keystroke can match, most specific first.
 *  - An ASCII letter/digit is matched by the character it types, so shortcuts follow the keyboard layout:
 *    AZERTY Ctrl+Z (physical W) is "z", not Close Editor; Dvorak Ctrl+X (physical B) is "x".
 *  - Only when the key types something that is not printable ASCII (macOS ⌥B = "∫", dead keys, Cyrillic or
 *    Greek layouts) does the physical letter (`e.code`) stand in.
 *  - Digits also fall back to the physical digit row (shifted digits, AZERTY's unshifted "&é\"'…").
 */
export function pressedKeyNames(e: KeyEventLike): string[] {
  const key = e.key
  if (ASCII_ALNUM.test(key)) return [key.toLowerCase()]
  const names = [normalizeKey(key)]
  const code = e.code.toLowerCase()
  const typesAscii = PRINTABLE_ASCII.test(key)
  if (code.startsWith('digit')) names.push(code.slice(5))
  else if (code.startsWith('key') && !typesAscii) names.push(code.slice(3))
  else if (!typesAscii || e.shiftKey) {
    // Symbol keys used by bindings, by position: Ctrl+Shift+` types "~" on US layouts, "²"/dead keys elsewhere.
    if (code === 'comma') names.push(',')
    else if (code === 'backquote') names.push('`')
    else if (code === 'backslash') names.push('\\')
  }
  return names
}

/** True when the keyboard event matches a binding like "mod+shift+p" on `platform`. */
export function matchesKeybindingOn(e: KeyEventLike, binding: string, platform: KeyPlatform): boolean {
  const isMac = platform === 'mac'
  const parts = binding.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const wantMod = parts.includes('mod')
  const wantCtrl = parts.includes('ctrl')
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')
  const modPressed = isMac ? e.metaKey : e.ctrlKey
  if (wantMod !== modPressed) return false
  if (isMac && wantCtrl !== e.ctrlKey) return false
  if (wantShift !== e.shiftKey) return false
  if (wantAlt !== e.altKey) return false
  if (isAltGrCharacter(e, platform)) return false
  return pressedKeyNames(e).includes(key)
}

/**
 * True when the event is exactly `chord`, written with *physical* modifier names ("ctrl+n", "meta+k",
 * "alt+shift+x") — used for keys a focused widget handles itself (`data-keys-passthrough`).
 */
export function matchesChord(e: KeyEventLike, chord: string): boolean {
  const parts = chord.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  if (parts.includes('ctrl') !== e.ctrlKey) return false
  if (parts.includes('meta') !== e.metaKey) return false
  if (parts.includes('alt') !== e.altKey) return false
  if (parts.includes('shift') !== e.shiftKey) return false
  return pressedKeyNames(e).includes(key)
}
