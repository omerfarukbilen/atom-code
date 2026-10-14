/**
 * Monaco bootstrap: local web workers (Vite `?worker` imports), the ATOM themes generated from the CSS design
 * tokens, TypeScript/JavaScript language defaults and the `@monaco-editor/react` loader configuration.
 *
 * Importing this module is enough to initialise Monaco; `applyMonacoTheme` re-themes it at runtime.
 */
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import type { ThemeId } from '@shared/types'
import { languageForPath } from '@shared/paths'
import { useSettingsStore } from '../stores/settings'
import { blend, readThemeColors, toHex, withAlpha } from './xterm-theme'

export { monaco }

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  }
}

loader.config({ monaco })

// ── Language defaults ────────────────────────────────────────────────────────

const compilerOptions: monaco.typescript.CompilerOptions = {
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
  jsx: monaco.typescript.JsxEmit.ReactJSX,
  allowJs: true,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  strict: true,
  noEmit: true
}

// Project types and node_modules are not loaded into Monaco, so semantic checking would flag every import
// ("Cannot find module …"). Keep syntax validation only — the agent and the real toolchain do type checking.
const diagnosticsOptions: monaco.typescript.DiagnosticsOptions = {
  noSemanticValidation: true,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: true
}

for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setCompilerOptions(compilerOptions)
  defaults.setDiagnosticsOptions(diagnosticsOptions)
  defaults.setEagerModelSync(true)
}

monaco.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  trailingCommas: 'warning',
  enableSchemaRequest: false
})

// ── Themes ───────────────────────────────────────────────────────────────────

interface TokenPalette {
  keyword: string
  string: string
  number: string
  func: string
  type: string
  property: string
  regexp: string
  tag: string
  operator: string
}

const DARK_TOKENS: TokenPalette = {
  keyword: 'c792ea',
  string: 'a5d6a7',
  number: 'f9a66c',
  func: '82aaff',
  type: 'ffcb6b',
  property: '89ddff',
  regexp: 'f78c6c',
  tag: 'f07178',
  operator: '89ddff'
}

const LIGHT_TOKENS: TokenPalette = {
  keyword: '8839ef',
  string: '2e7d32',
  number: 'd9480f',
  func: '1e66f5',
  type: 'b7791f',
  property: '0b7285',
  regexp: 'c2410c',
  tag: 'd20f39',
  operator: '0b7285'
}

const strip = (hex: string): string => hex.replace('#', '').slice(0, 6)

function buildTheme(themeId: ThemeId): monaco.editor.IStandaloneThemeData {
  const c = readThemeColors(themeId, true)
  const t = c.isLight ? LIGHT_TOKENS : DARK_TOKENS
  const bg = c.app
  const comment = strip(c.subtle)
  const fg = strip(c.fg)

  const rules: monaco.editor.ITokenThemeRule[] = [
    { token: '', foreground: fg },
    { token: 'comment', foreground: comment, fontStyle: 'italic' },
    { token: 'comment.doc', foreground: comment, fontStyle: 'italic' },
    { token: 'keyword', foreground: t.keyword },
    { token: 'keyword.flow', foreground: t.keyword },
    { token: 'keyword.control', foreground: t.keyword },
    { token: 'keyword.operator', foreground: t.operator },
    { token: 'storage', foreground: t.keyword },
    { token: 'string', foreground: t.string },
    { token: 'string.escape', foreground: t.property },
    { token: 'string.key.json', foreground: t.property },
    { token: 'string.value.json', foreground: t.string },
    { token: 'string.link', foreground: t.func },
    { token: 'number', foreground: t.number },
    { token: 'number.hex', foreground: t.number },
    { token: 'constant', foreground: t.number },
    { token: 'keyword.json', foreground: t.number },
    { token: 'regexp', foreground: t.regexp },
    { token: 'type', foreground: t.type },
    { token: 'type.identifier', foreground: t.type },
    { token: 'entity.name.type', foreground: t.type },
    { token: 'entity.name.class', foreground: t.type },
    { token: 'support.type', foreground: t.type },
    { token: 'function', foreground: t.func },
    { token: 'entity.name.function', foreground: t.func },
    { token: 'support.function', foreground: t.func },
    { token: 'predefined', foreground: t.func },
    { token: 'identifier', foreground: fg },
    { token: 'variable', foreground: fg },
    { token: 'variable.predefined', foreground: t.type },
    { token: 'variable.parameter', foreground: t.number },
    { token: 'attribute.name', foreground: t.property },
    { token: 'attribute.value', foreground: t.string },
    { token: 'attribute.value.number', foreground: t.number },
    { token: 'attribute.value.unit', foreground: t.number },
    { token: 'tag', foreground: t.tag },
    { token: 'metatag', foreground: t.keyword },
    { token: 'annotation', foreground: t.type },
    { token: 'delimiter', foreground: strip(c.muted) },
    { token: 'delimiter.bracket', foreground: strip(c.muted) },
    { token: 'operator', foreground: t.operator },
    { token: 'operators', foreground: t.operator },
    { token: 'keyword.md', foreground: t.keyword, fontStyle: 'bold' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'variable.source', foreground: t.func },
    { token: 'invalid', foreground: strip(c.danger) }
  ]

  const lineHighlight = withAlpha(c.fg, c.isLight ? 0.04 : 0.035)
  const widgetBg = c.elevated
  const colors: monaco.editor.IColors = {
    'editor.background': bg,
    'editor.foreground': c.fg,
    'editorCursor.foreground': c.accent,
    'editor.lineHighlightBackground': lineHighlight,
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': withAlpha(c.accent, c.isLight ? 0.2 : 0.28),
    'editor.inactiveSelectionBackground': withAlpha(c.accent, c.isLight ? 0.1 : 0.14),
    'editor.selectionHighlightBackground': withAlpha(c.accent, 0.12),
    'editor.wordHighlightBackground': withAlpha(c.accent, 0.12),
    'editor.wordHighlightStrongBackground': withAlpha(c.accent, 0.18),
    'editor.findMatchBackground': withAlpha(c.warning, 0.35),
    'editor.findMatchHighlightBackground': withAlpha(c.warning, 0.16),
    'editor.findRangeHighlightBackground': withAlpha(c.accent, 0.08),
    'editor.rangeHighlightBackground': withAlpha(c.accent, 0.1),
    'editorLink.activeForeground': c.accent,
    'editorLineNumber.foreground': blend(withAlpha(c.subtle, 0.75), bg),
    'editorLineNumber.activeForeground': c.fg,
    'editorGutter.background': bg,
    'editorGutter.addedBackground': c.success,
    'editorGutter.modifiedBackground': c.info,
    'editorGutter.deletedBackground': c.danger,
    'editorIndentGuide.background1': withAlpha(c['line-strong'], 0.55),
    'editorIndentGuide.activeBackground1': c['line-strong'],
    'editorWhitespace.foreground': withAlpha(c.subtle, 0.4),
    'editorRuler.foreground': c.line,
    'editorCodeLens.foreground': c.subtle,
    'editorBracketMatch.background': withAlpha(c.accent, 0.14),
    'editorBracketMatch.border': withAlpha(c.accent, 0.5),
    'editorBracketHighlight.foreground1': c.isLight ? '#b7791f' : '#ffd479',
    'editorBracketHighlight.foreground2': c.isLight ? '#8839ef' : '#d39bff',
    'editorBracketHighlight.foreground3': c.isLight ? '#1e66f5' : '#7fb4ff',
    'editorBracketHighlight.foreground4': c.isLight ? '#0f9f94' : '#5fd7c9',
    'editorBracketHighlight.foreground5': c.isLight ? '#d9480f' : '#ffa07a',
    'editorBracketHighlight.foreground6': c.isLight ? '#2e7d32' : '#a5d6a7',
    'editorBracketHighlight.unexpectedBracket.foreground': c.danger,
    'editorOverviewRuler.border': '#00000000',
    'editorOverviewRuler.errorForeground': c.danger,
    'editorOverviewRuler.warningForeground': c.warning,
    'editorOverviewRuler.infoForeground': c.info,
    'editorError.foreground': c.danger,
    'editorWarning.foreground': c.warning,
    'editorInfo.foreground': c.info,
    'editorHint.foreground': c.subtle,
    'editorUnnecessaryCode.opacity': '#00000088',
    'editorWidget.background': widgetBg,
    'editorWidget.foreground': c.fg,
    'editorWidget.border': c.line,
    'editorWidget.resizeBorder': c.accent,
    'editorSuggestWidget.background': widgetBg,
    'editorSuggestWidget.border': c.line,
    'editorSuggestWidget.foreground': c.fg,
    'editorSuggestWidget.selectedBackground': withAlpha(c.accent, 0.2),
    'editorSuggestWidget.selectedForeground': c.fg,
    'editorSuggestWidget.highlightForeground': c.accent,
    'editorSuggestWidget.focusHighlightForeground': c.accent,
    'editorHoverWidget.background': widgetBg,
    'editorHoverWidget.border': c.line,
    'editorHoverWidget.statusBarBackground': c.overlay,
    'editorStickyScroll.background': bg,
    'editorStickyScrollHover.background': blend(c.hover, bg),
    'editorStickyScroll.shadow': withAlpha('#000000', c.isLight ? 0.08 : 0.35),
    'editorGroupHeader.tabsBackground': c.sidebar,
    'peekView.border': c.accent,
    'peekViewEditor.background': c.sidebar,
    'peekViewResult.background': c.sidebar,
    'peekViewTitle.background': c.elevated,
    'widget.shadow': withAlpha('#000000', c.isLight ? 0.12 : 0.45),
    'widget.border': c.line,
    focusBorder: withAlpha(c.accent, 0.6),
    contrastBorder: '#00000000',
    foreground: c.fg,
    descriptionForeground: c.muted,
    errorForeground: c.danger,
    'icon.foreground': c.muted,
    'input.background': c.input,
    'input.foreground': c.fg,
    'input.border': c.line,
    'input.placeholderForeground': c.subtle,
    'inputOption.activeBackground': withAlpha(c.accent, 0.25),
    'inputOption.activeBorder': withAlpha(c.accent, 0.6),
    'inputValidation.errorBackground': c.elevated,
    'inputValidation.errorBorder': c.danger,
    'list.hoverBackground': blend(c.hover, widgetBg),
    'list.activeSelectionBackground': withAlpha(c.accent, 0.22),
    'list.activeSelectionForeground': c.fg,
    'list.inactiveSelectionBackground': blend(c.active, widgetBg),
    'list.focusBackground': withAlpha(c.accent, 0.18),
    'list.focusForeground': c.fg,
    'list.highlightForeground': c.accent,
    'list.focusHighlightForeground': c.accent,
    'quickInput.background': widgetBg,
    'quickInput.foreground': c.fg,
    'quickInputList.focusBackground': withAlpha(c.accent, 0.2),
    'pickerGroup.border': c.line,
    'pickerGroup.foreground': c.accent,
    'menu.background': c.overlay,
    'menu.foreground': c.fg,
    'menu.border': c.line,
    'menu.selectionBackground': withAlpha(c.accent, 0.22),
    'menu.selectionForeground': c.fg,
    'menu.separatorBackground': c.line,
    'keybindingLabel.background': c.elevated,
    'keybindingLabel.foreground': c.muted,
    'keybindingLabel.border': c.line,
    'keybindingLabel.bottomBorder': c.line,
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': c.scrollbar,
    'scrollbarSlider.hoverBackground': c['scrollbar-hover'],
    'scrollbarSlider.activeBackground': c['scrollbar-hover'],
    'minimap.background': bg,
    'minimap.selectionHighlight': withAlpha(c.accent, 0.5),
    'minimap.findMatchHighlight': withAlpha(c.warning, 0.6),
    'minimapSlider.background': withAlpha(c.fg, 0.06),
    'minimapSlider.hoverBackground': withAlpha(c.fg, 0.1),
    'minimapSlider.activeBackground': withAlpha(c.fg, 0.14),
    'diffEditor.insertedTextBackground': withAlpha(c.success, c.isLight ? 0.2 : 0.22),
    'diffEditor.removedTextBackground': withAlpha(c.danger, c.isLight ? 0.18 : 0.22),
    'diffEditor.insertedLineBackground': c['diff-add'],
    'diffEditor.removedLineBackground': c['diff-del'],
    'diffEditorGutter.insertedLineBackground': c['diff-add'],
    'diffEditorGutter.removedLineBackground': c['diff-del'],
    'diffEditor.diagonalFill': withAlpha(c['line-strong'], 0.5),
    'diffEditor.unchangedRegionBackground': c.sidebar,
    'diffEditor.unchangedRegionForeground': c.muted,
    'diffEditor.unchangedCodeBackground': withAlpha(c.fg, 0.03),
    'diffEditor.border': c.line,
    'editorMarkerNavigation.background': widgetBg,
    'editorMarkerNavigationError.background': c.danger,
    'editorMarkerNavigationWarning.background': c.warning,
    'editorMarkerNavigationInfo.background': c.info,
    'textLink.foreground': c.accent,
    'textLink.activeForeground': toHex(c['accent-hover']),
    'textCodeBlock.background': c.sidebar,
    'badge.background': c.accent,
    'badge.foreground': c['accent-fg'],
    'progressBar.background': c.accent
  }

  return { base: c.isLight ? 'vs' : 'vs-dark', inherit: true, rules, colors }
}

const THEME_IDS: ThemeId[] = ['atom-dark', 'atom-midnight', 'atom-light']

/** (Re)define the ATOM theme for `themeId` from the current CSS tokens and activate it. */
export function applyMonacoTheme(themeId: ThemeId): void {
  try {
    monaco.editor.defineTheme(themeId, buildTheme(themeId))
    monaco.editor.setTheme(themeId)
  } catch (err) {
    console.error('[monaco] failed to apply theme', themeId, err)
  }
}

function defineAllThemes(): void {
  for (const id of THEME_IDS) {
    try {
      monaco.editor.defineTheme(id, buildTheme(id))
    } catch (err) {
      console.error('[monaco] failed to define theme', id, err)
    }
  }
}

defineAllThemes()
applyMonacoTheme(useSettingsStore.getState().settings.theme)

useSettingsStore.subscribe((state, prev) => {
  if (state.settings.theme !== prev.settings.theme) applyMonacoTheme(state.settings.theme)
})

// Editor-specific decoration styles (kept here so they ship with the editor integration).
const EDITOR_CSS = `
.monaco-editor .atom-reveal-highlight { animation: atom-reveal-fade 1.6s ease-out forwards; }
@keyframes atom-reveal-fade { 0%, 45% { background: var(--accent-soft); } 100% { background: transparent; } }
.monaco-editor .atom-inline-added { background: var(--diff-add); }
.monaco-editor .atom-inline-added-gutter { border-left: 3px solid var(--success); margin-left: 3px; }
.monaco-editor .atom-inline-pending { background: var(--accent-soft); }
.monaco-editor .atom-inline-pending-gutter { border-left: 3px solid var(--accent); margin-left: 3px; }
.monaco-editor .atom-inline-widget { z-index: 40; }
.monaco-editor .monaco-hover { border-radius: 6px; overflow: hidden; }
.monaco-editor .suggest-widget { border-radius: 6px; }
`

function injectEditorStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('atom-editor-styles')) return
  const style = document.createElement('style')
  style.id = 'atom-editor-styles'
  style.textContent = EDITOR_CSS
  document.head.appendChild(style)
}

injectEditorStyles()

// The variable fonts load asynchronously; Monaco caches glyph metrics, so re-measure once they are ready.
if (typeof document !== 'undefined' && document.fonts) {
  const remeasure = (): void => monaco.editor.remeasureFonts()
  void document.fonts
    .load('14px "JetBrains Mono Variable"')
    .then(remeasure)
    .catch(() => undefined)
  document.fonts.addEventListener('loadingdone', remeasure)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The URI of the single text model ATOM keeps for a file on disk. */
export function fileUri(path: string): monaco.Uri {
  return monaco.Uri.file(path)
}

let knownLanguages: Set<string> | null = null

/** Monaco language id for a path, falling back to plaintext for ids Monaco does not know. */
export function monacoLanguageForPath(path: string): string {
  const id = languageForPath(path)
  if (!knownLanguages) knownLanguages = new Set(monaco.languages.getLanguages().map((l) => l.id))
  return knownLanguages.has(id) ? id : 'plaintext'
}

/** Pretty language label for UI, e.g. "TypeScript". */
export function languageLabel(languageId: string): string {
  const lang = monaco.languages.getLanguages().find((l) => l.id === languageId)
  const alias = lang?.aliases?.[0]
  if (alias) return alias
  return languageId === 'plaintext' ? 'Plain Text' : languageId.charAt(0).toUpperCase() + languageId.slice(1)
}
