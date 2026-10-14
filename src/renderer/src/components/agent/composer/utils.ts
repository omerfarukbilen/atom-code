/** Pure helpers for the composer: popup (@ / slash) detection, caret geometry, token formatting. */

export type ComposerPopup =
  | { kind: 'mention'; /** index of the "@" */ start: number; query: string }
  | { kind: 'slash'; query: string }
  | { kind: 'slash-arg'; command: 'mode' | 'model'; query: string }

/** Which popup (if any) the text + caret position should show. */
export function detectPopup(value: string, caret: number): ComposerPopup | null {
  const arg = /^\/(mode|model)\s+(\S*)$/.exec(value)
  if (arg && caret === value.length) return { kind: 'slash-arg', command: arg[1] as 'mode' | 'model', query: arg[2] }

  if (value.startsWith('/') && caret >= 1) {
    const firstSpace = value.search(/\s/)
    if (firstSpace === -1 || caret <= firstSpace) return { kind: 'slash', query: value.slice(1, caret) }
  }

  const before = value.slice(0, caret)
  const m = /(^|\s)@([^\s@]{0,120})$/.exec(before)
  if (m) return { kind: 'mention', start: caret - m[2].length - 1, query: m[2] }
  return null
}

export function samePopup(a: ComposerPopup | null, b: ComposerPopup | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind || a.query !== b.query) return false
  if (a.kind === 'mention' && b.kind === 'mention') return a.start === b.start
  if (a.kind === 'slash-arg' && b.kind === 'slash-arg') return a.command === b.command
  return true
}

const MIRROR_PROPS = [
  'direction',
  'box-sizing',
  'width',
  'height',
  'overflow-x',
  'overflow-y',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-style',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'font-size',
  'font-size-adjust',
  'line-height',
  'font-family',
  'font-feature-settings',
  'text-align',
  'text-transform',
  'text-indent',
  'text-decoration',
  'letter-spacing',
  'word-spacing',
  'tab-size'
]

/** Pixel position of a character offset inside a textarea (relative to the textarea's border box). */
export function caretCoordinates(el: HTMLTextAreaElement, position: number): { top: number; left: number; height: number } {
  const computed = getComputedStyle(el)
  const mirror = document.createElement('div')
  const style = mirror.style
  for (const prop of MIRROR_PROPS) style.setProperty(prop, computed.getPropertyValue(prop))
  style.position = 'absolute'
  style.visibility = 'hidden'
  style.top = '0'
  style.left = '-9999px'
  style.whiteSpace = 'pre-wrap'
  style.overflowWrap = 'break-word'
  style.overflow = 'hidden'
  mirror.textContent = el.value.slice(0, position)
  const marker = document.createElement('span')
  marker.textContent = el.value.slice(position) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.45
  const top = marker.offsetTop + (parseFloat(computed.borderTopWidth) || 0) - el.scrollTop
  const left = marker.offsetLeft + (parseFloat(computed.borderLeftWidth) || 0) - el.scrollLeft
  document.body.removeChild(mirror)
  return { top, left, height: lineHeight }
}

/** 45231 → "45k", 1_200_000 → "1.2M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(Math.round(n))
}

export function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
