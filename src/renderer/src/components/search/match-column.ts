/**
 * Pure helpers for search results (no DOM / store dependencies, unit-tested in tests/search-column.test.ts).
 */

/** Leading marker main puts on a preview it windowed around the match (see `buildPreview` in main/services/search.ts). */
const WINDOW_MARK = '…'

/** True when `column` may be relative to a trimmed window of the line rather than to the line itself. */
export function isWindowedPreview(preview: string): boolean {
  return preview.startsWith(WINDOW_MARK)
}

/**
 * 1-based column of a match in the full line. `SearchMatch.column` counts in `preview`, which main trims
 * for lines over 300 chars: a match past the cut gets a window of the line around it, prefixed with "…".
 * The window is located in `lineText` to translate the column; when it cannot be found (the buffer changed
 * since the search) the preview column is returned unchanged.
 */
export function absoluteMatchColumn(preview: string, column: number, lineText: string): number {
  if (!isWindowedPreview(preview)) return column
  const window = preview.slice(WINDOW_MARK.length)
  if (!window) return column
  const from = lineText.indexOf(window)
  return from >= 0 ? from + column - WINDOW_MARK.length : column
}
