import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAltGrCharacter,
  matchesChord,
  matchesKeybindingOn,
  pressedKeyNames,
  type KeyEventLike
} from '../src/renderer/src/components/workbench/keybinding-match.ts'

function key(init: Partial<KeyEventLike> & { key: string; code: string; altGraph?: boolean }): KeyEventLike {
  const { altGraph = false, ...rest } = init
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    getModifierState: (k: string) => k === 'AltGraph' && altGraph,
    ...rest
  }
}

describe('keyboard layouts', () => {
  it('matches letters by the character typed, not the physical key (AZERTY Ctrl+Z is not Ctrl+W)', () => {
    const azertyCtrlZ = key({ key: 'z', code: 'KeyW', ctrlKey: true })
    assert.equal(matchesKeybindingOn(azertyCtrlZ, 'mod+w', 'linux'), false)
    assert.equal(matchesKeybindingOn(azertyCtrlZ, 'mod+z', 'linux'), true)
    const azertyCmdZ = key({ key: 'z', code: 'KeyW', metaKey: true })
    assert.equal(matchesKeybindingOn(azertyCmdZ, 'mod+w', 'mac'), false)
  })

  it('Dvorak Ctrl+X does not toggle the sidebar (physical B)', () => {
    const e = key({ key: 'x', code: 'KeyB', ctrlKey: true })
    assert.equal(matchesKeybindingOn(e, 'mod+b', 'windows'), false)
    assert.equal(matchesKeybindingOn(key({ key: 'b', code: 'KeyN', ctrlKey: true }), 'mod+b', 'windows'), true)
  })

  it('falls back to the physical key when the key types no ASCII character', () => {
    // macOS ⌥ combos type symbols: ⌘⌥B = "∫", ⌥Z = "Ω".
    assert.equal(matchesKeybindingOn(key({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }), 'mod+alt+b', 'mac'), true)
    assert.equal(matchesKeybindingOn(key({ key: 'Ω', code: 'KeyZ', altKey: true }), 'alt+z', 'mac'), true)
    // Cyrillic layout: Ctrl+P types "з".
    assert.equal(matchesKeybindingOn(key({ key: 'з', code: 'KeyP', ctrlKey: true }), 'mod+p', 'linux'), true)
    // Dead keys.
    assert.deepEqual(pressedKeyNames(key({ key: 'Dead', code: 'KeyE', altKey: true })), ['dead', 'e'])
  })

  it('does not treat ASCII punctuation on a letter key as that letter', () => {
    // Dvorak: physical Q types an apostrophe.
    assert.equal(matchesKeybindingOn(key({ key: "'", code: 'KeyQ', ctrlKey: true }), 'mod+q', 'linux'), false)
  })

  it('matches digits by the digit row and shifted symbols by position', () => {
    assert.equal(matchesKeybindingOn(key({ key: '&', code: 'Digit1', ctrlKey: true }), 'mod+1', 'linux'), true)
    assert.equal(matchesKeybindingOn(key({ key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true }), 'mod+shift+`', 'linux'), true)
    assert.equal(matchesKeybindingOn(key({ key: '`', code: 'Backquote', ctrlKey: true }), 'ctrl+`', 'mac'), true)
    assert.equal(matchesKeybindingOn(key({ key: '²', code: 'Backquote', ctrlKey: true }), 'mod+`', 'windows'), true)
    // AZERTY: the ";" key sits where US has ",": it is not Settings.
    assert.equal(matchesKeybindingOn(key({ key: ';', code: 'Comma', ctrlKey: true }), 'mod+,', 'linux'), false)
    assert.equal(matchesKeybindingOn(key({ key: ',', code: 'KeyM', ctrlKey: true }), 'mod+,', 'linux'), true)
  })

  it('still matches named keys and modifiers exactly', () => {
    assert.equal(matchesKeybindingOn(key({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }), 'mod+shift+p', 'windows'), true)
    assert.equal(matchesKeybindingOn(key({ key: 'p', code: 'KeyP', ctrlKey: true }), 'mod+shift+p', 'windows'), false)
    assert.equal(matchesKeybindingOn(key({ key: 'Tab', code: 'Tab', ctrlKey: true }), 'ctrl+tab', 'mac'), true)
    assert.equal(matchesKeybindingOn(key({ key: 'Tab', code: 'Tab', metaKey: true }), 'ctrl+tab', 'mac'), false)
    assert.equal(matchesKeybindingOn(key({ key: 'g', code: 'KeyG', ctrlKey: true }), 'ctrl+g', 'mac'), true)
  })
})

describe('AltGr', () => {
  it('Windows AltGr (Ctrl+Alt) characters never trigger Ctrl+Alt bindings', () => {
    // Polish (Programmers) AltGr+S = "ś" must not run Save All; Hungarian AltGr+B = "{" must not toggle the agent.
    const polish = key({ key: 'ś', code: 'KeyS', ctrlKey: true, altKey: true, altGraph: true })
    const hungarian = key({ key: '{', code: 'KeyB', ctrlKey: true, altKey: true, altGraph: true })
    assert.equal(matchesKeybindingOn(polish, 'mod+alt+s', 'windows'), false)
    assert.equal(matchesKeybindingOn(hungarian, 'mod+alt+b', 'windows'), false)
    // Older Chromium: no AltGraph state, only Ctrl+Alt.
    const legacy = key({ key: '{', code: 'KeyB', ctrlKey: true, altKey: true })
    assert.equal(isAltGrCharacter(legacy, 'windows'), true)
    assert.equal(matchesKeybindingOn(legacy, 'mod+alt+b', 'windows'), false)
  })

  it('a real Ctrl+Alt shortcut still works', () => {
    assert.equal(matchesKeybindingOn(key({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true }), 'mod+alt+s', 'windows'), true)
    assert.equal(matchesKeybindingOn(key({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true, altGraph: true }), 'mod+alt+right', 'windows'), true)
  })

  it('Linux AltGr characters are not shortcuts either', () => {
    assert.equal(isAltGrCharacter(key({ key: '@', code: 'KeyQ', altGraph: true }), 'linux'), true)
    assert.equal(isAltGrCharacter(key({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true }), 'linux'), false)
  })

  it('macOS Option combos are not AltGr', () => {
    assert.equal(isAltGrCharacter(key({ key: 'ß', code: 'KeyS', metaKey: true, altKey: true, altGraph: true }), 'mac'), false)
    assert.equal(matchesKeybindingOn(key({ key: 'ß', code: 'KeyS', metaKey: true, altKey: true }), 'mod+alt+s', 'mac'), true)
  })
})

describe('matchesChord (physical modifiers)', () => {
  it('matches the palette navigation keys exactly', () => {
    assert.equal(matchesChord(key({ key: 'n', code: 'KeyN', ctrlKey: true }), 'ctrl+n'), true)
    assert.equal(matchesChord(key({ key: 'p', code: 'KeyP', ctrlKey: true }), 'ctrl+p'), true)
    assert.equal(matchesChord(key({ key: 'p', code: 'KeyP', ctrlKey: true, shiftKey: true }), 'ctrl+p'), false)
    assert.equal(matchesChord(key({ key: 'p', code: 'KeyP', metaKey: true }), 'ctrl+p'), false)
  })
})
