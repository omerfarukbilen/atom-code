import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { absoluteMatchColumn, isWindowedPreview } from '../src/renderer/src/components/search/match-column.ts'

/** Mirror of main's buildPreview (main/services/search.ts): 300-char previews, windowed with "…" past the cut. */
function buildPreview(lineText: string, start: number, length: number): { preview: string; column: number } {
  const MAX = 300
  const BEFORE = 60
  if (lineText.length <= MAX || start + length <= MAX) return { preview: lineText.slice(0, MAX), column: start + 1 }
  const from = Math.max(0, start - BEFORE)
  return { preview: `…${lineText.slice(from, from + MAX - 1)}`, column: start - from + 2 }
}

describe('search match columns', () => {
  it('keeps the column of short lines and of matches before the cut', () => {
    const line = 'const answer = 42'
    const { preview, column } = buildPreview(line, 6, 6)
    assert.equal(isWindowedPreview(preview), false)
    assert.equal(absoluteMatchColumn(preview, column, line), 7)
  })

  it('translates a windowed preview column back to the line column', () => {
    const line = `${'a=1;'.repeat(175)}needle();${'b=2;'.repeat(50)}`
    const start = line.indexOf('needle')
    const { preview, column } = buildPreview(line, start, 6)
    assert.equal(isWindowedPreview(preview), true)
    assert.notEqual(column, start + 1)
    assert.equal(absoluteMatchColumn(preview, column, line), start + 1)
    assert.equal(line.slice(absoluteMatchColumn(preview, column, line) - 1).startsWith('needle'), true)
  })

  it('handles a line that itself starts with an ellipsis', () => {
    const line = '…and then something'
    assert.equal(absoluteMatchColumn(line, 11, line), 11)
  })

  it('falls back to the preview column when the line changed since the search', () => {
    assert.equal(absoluteMatchColumn('…xyz needle', 6, 'completely different'), 6)
  })
})
