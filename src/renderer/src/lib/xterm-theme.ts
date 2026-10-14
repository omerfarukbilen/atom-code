import type { ITheme } from '@xterm/xterm'
import type { ThemeId } from '@shared/types'

/**
 * Theme color helpers shared by the Monaco and xterm integrations.
 *
 * Both libraries need concrete colors (Monaco only accepts hex), while the app defines its palette as CSS
 * custom properties in globals.css. We resolve the variables for a given theme on a hidden probe element
 * carrying `data-theme`, so any theme can be read regardless of which one is currently applied.
 */

const TOKEN_NAMES = [
  'app',
  'sidebar',
  'panel',
  'titlebar',
  'elevated',
  'overlay',
  'input',
  'hover',
  'active',
  'selection',
  'line',
  'line-strong',
  'fg',
  'muted',
  'subtle',
  'accent',
  'accent-hover',
  'accent-soft',
  'accent-fg',
  'accent-2',
  'success',
  'warning',
  'danger',
  'info',
  'diff-add',
  'diff-del',
  'scrollbar',
  'scrollbar-hover'
] as const

export type ThemeToken = (typeof TOKEN_NAMES)[number]
export type ThemeColors = Record<ThemeToken, string> & { isLight: boolean }

let canvasCtx: CanvasRenderingContext2D | null = null

function ctx(): CanvasRenderingContext2D | null {
  if (!canvasCtx) canvasCtx = document.createElement('canvas').getContext('2d')
  return canvasCtx
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')
}

/** RGBA components (0–255, alpha 0–1) of any CSS color string, or null when it cannot be parsed. */
export function parseColor(input: string): { r: number; g: number; b: number; a: number } | null {
  const value = input.trim()
  if (!value) return null
  const c = ctx()
  let normalized = value
  if (c) {
    // The canvas normalizes every CSS color syntax to "#rrggbb" or "rgba(r, g, b, a)".
    c.fillStyle = '#000000'
    c.fillStyle = value
    normalized = String(c.fillStyle)
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(normalized)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(normalized)
  if (rgb) {
    const alphaRaw = rgb[4]
    const a = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw)
    return { r: parseFloat(rgb[1]), g: parseFloat(rgb[2]), b: parseFloat(rgb[3]), a }
  }
  return null
}

/** Any CSS color → "#rrggbb" or "#rrggbbaa" (when translucent). Falls back to `fallback`. */
export function toHex(input: string, fallback = '#000000'): string {
  const c = parseColor(input)
  if (!c) return fallback
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
  return c.a >= 0.999 ? base : `${base}${hex2(c.a * 255)}`
}

/** Same color with a different alpha (0–1), as "#rrggbbaa". */
export function withAlpha(input: string, alpha: number): string {
  const c = parseColor(input)
  if (!c) return input
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${hex2(alpha * 255)}`
}

/** Composite a (possibly translucent) color over an opaque background → opaque "#rrggbb". */
export function blend(color: string, background: string): string {
  const fg = parseColor(color)
  const bg = parseColor(background)
  if (!fg || !bg) return toHex(color)
  const a = fg.a
  return `#${hex2(fg.r * a + bg.r * (1 - a))}${hex2(fg.g * a + bg.g * (1 - a))}${hex2(fg.b * a + bg.b * (1 - a))}`
}

const cache = new Map<string, ThemeColors>()

/** Resolve every design token of `themeId` to a hex color. Cached per theme. */
export function readThemeColors(themeId: ThemeId, fresh = false): ThemeColors {
  const hit = cache.get(themeId)
  if (hit && !fresh) return hit
  const probe = document.createElement('div')
  probe.dataset.theme = themeId
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const out = { isLight: themeId === 'atom-light' } as ThemeColors
  for (const name of TOKEN_NAMES) out[name] = toHex(style.getPropertyValue(`--${name}`), '#808080')
  probe.remove()
  cache.set(themeId, out)
  return out
}

/** Prefer the bundled variable fonts when the user's font stack names the static family. */
export function withBundledFonts(fontFamily: string): string {
  let ff = fontFamily.trim() || 'monospace'
  if (/jetbrains mono/i.test(ff) && !/jetbrains mono variable/i.test(ff)) {
    ff = ff.replace(/(['"]?)JetBrains Mono\1/i, "'JetBrains Mono Variable', 'JetBrains Mono'")
  }
  if (!/monospace\s*$/i.test(ff)) ff += ', monospace'
  return ff
}

// ── xterm ────────────────────────────────────────────────────────────────────

const DARK_ANSI = {
  black: '#1e2030',
  magenta: '#c792ea',
  white: '#c8ccd8',
  brightBlack: '#5c6178',
  brightRed: '#ff8a8a',
  brightGreen: '#86efac',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#ddb6f2',
  brightCyan: '#7ee7dc',
  brightWhite: '#ffffff'
}

const LIGHT_ANSI = {
  black: '#1d1f2a',
  magenta: '#8839ef',
  white: '#8c8fa1',
  brightBlack: '#5b5e70',
  brightRed: '#b91c1c',
  brightGreen: '#15803d',
  brightYellow: '#a16207',
  brightBlue: '#1d4ed8',
  brightMagenta: '#7e22ce',
  brightCyan: '#0e7490',
  brightWhite: '#1d1f2a'
}

/** xterm theme for the bottom panel, derived from the design tokens of `themeId`. */
export function buildXtermTheme(themeId: ThemeId): ITheme {
  const c = readThemeColors(themeId)
  const ansi = c.isLight ? LIGHT_ANSI : DARK_ANSI
  return {
    background: c.panel,
    foreground: c.fg,
    cursor: c.accent,
    cursorAccent: c.panel,
    selectionBackground: withAlpha(c.accent, c.isLight ? 0.22 : 0.3),
    selectionInactiveBackground: withAlpha(c.accent, 0.14),
    scrollbarSliderBackground: c.scrollbar,
    scrollbarSliderHoverBackground: c['scrollbar-hover'],
    scrollbarSliderActiveBackground: c['scrollbar-hover'],
    overviewRulerBorder: c.panel,
    red: c.danger,
    green: c.success,
    yellow: c.warning,
    blue: c.info,
    cyan: c['accent-2'],
    ...ansi
  }
}
