import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { UnencodableCharacterError, decodeText, encodeText } from '../src/main/services/text-encoding.ts'

const bytes = (...b: number[]): Buffer => Buffer.from(b)

describe('decodeText / encodeText', () => {
  it('reads plain UTF-8 and writes it back unchanged', () => {
    const buf = Buffer.from('héllo — 世界\n', 'utf8')
    const { text, encoding } = decodeText(buf)
    assert.equal(encoding, 'utf8')
    assert.equal(text, 'héllo — 世界\n')
    assert.deepEqual(encodeText(text, encoding), buf)
  })

  it('remembers a UTF-8 byte order mark and re-adds it once on save', () => {
    const buf = Buffer.concat([bytes(0xef, 0xbb, 0xbf), Buffer.from('hello\n')])
    const { text, encoding } = decodeText(buf)
    assert.equal(encoding, 'utf8bom')
    assert.equal(text, 'hello\n')
    assert.deepEqual(encodeText(text + 'x', encoding), Buffer.concat([buf, Buffer.from('x')]))
    assert.deepEqual(encodeText('\uFEFFhello\n', encoding), buf)
  })

  it('reads invalid UTF-8 as Windows-1252 and saves the same bytes (no U+FFFD)', () => {
    const latin1 = bytes(0x63, 0x61, 0x66, 0xe9, 0x0a) // "café\n" in Latin-1
    const { text, encoding } = decodeText(latin1)
    assert.equal(encoding, 'windows-1252')
    assert.equal(text, 'café\n')
    assert.deepEqual(encodeText(text + 'x', encoding), Buffer.concat([latin1, bytes(0x78)]))
    const cp1252 = bytes(0x80, 0x93, 0x94, 0x99) // € “ ” ™
    assert.equal(decodeText(cp1252).text, '€“”™')
  })

  it('round-trips every byte value through Windows-1252', () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
    const { text, encoding } = decodeText(all)
    assert.equal(encoding, 'windows-1252')
    assert.deepEqual(encodeText(text, encoding), all)
  })

  it('refuses characters Windows-1252 cannot store instead of corrupting the file', () => {
    assert.throws(
      () => encodeText('ok\nsmile 😀', 'windows-1252'),
      (err: unknown) => err instanceof UnencodableCharacterError && err.line === 2 && err.character === '😀'
    )
  })
})
