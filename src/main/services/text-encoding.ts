/**
 * Text decoding/encoding for the editor (pure, unit tested).
 *
 * Files are decoded as strict UTF-8 (a leading byte order mark is remembered); bytes that are not valid
 * UTF-8 are read as Windows-1252, the usual legacy encoding (a superset of printable Latin-1). Saving
 * re-encodes with the same encoding, so a Latin-1 `.properties` file or a UTF-8-with-BOM PowerShell
 * script round-trips byte for byte instead of being rewritten with U+FFFD replacement characters.
 */
import type { TextEncodingId } from '../../shared/types'

/** Code points of Windows-1252 bytes 0x80–0x9F (undefined bytes map to the matching C1 control, as in WHATWG). */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178
]
const CP1252_REVERSE = new Map<number, number>(CP1252_HIGH.map((cp, i) => [cp, 0x80 + i]))

const utf8Strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function hasUtf8Bom(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
}

function decodeCp1252(buf: Uint8Array): string {
  const CHUNK = 8192
  let out = ''
  const units = new Uint16Array(Math.min(CHUNK, buf.length))
  for (let offset = 0; offset < buf.length; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, buf.length)
    for (let i = offset; i < end; i++) {
      const b = buf[i]
      units[i - offset] = b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : b
    }
    out += String.fromCharCode(...units.subarray(0, end - offset))
  }
  return out
}

/** Decode file bytes for the editor, reporting the encoding they were in. */
export function decodeText(buf: Uint8Array): { text: string; encoding: TextEncodingId } {
  if (hasUtf8Bom(buf)) {
    try {
      return { text: utf8Strict.decode(buf.subarray(3)), encoding: 'utf8bom' }
    } catch {
      /* not UTF-8 after all: fall through to the legacy decoding (the BOM bytes round-trip too) */
    }
  } else {
    try {
      return { text: utf8Strict.decode(buf), encoding: 'utf8' }
    } catch {
      /* invalid UTF-8 */
    }
  }
  return { text: decodeCp1252(buf), encoding: 'windows-1252' }
}

/** Thrown when text contains a character the file's encoding cannot store. */
export class UnencodableCharacterError extends Error {
  readonly encoding: TextEncodingId
  readonly character: string
  readonly line: number

  constructor(encoding: TextEncodingId, character: string, line: number) {
    super(
      `This file is saved as Windows-1252, which cannot store the character “${character}” (line ${line}). ` +
        'Remove or replace it, or copy the text into a new (UTF-8) file.'
    )
    this.name = 'UnencodableCharacterError'
    this.encoding = encoding
    this.character = character
    this.line = line
  }
}

function encodeCp1252(text: string): Buffer {
  const out = Buffer.allocUnsafe(text.length)
  let line = 1
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x0a) line++
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) {
      out[i] = c
      continue
    }
    const byte = CP1252_REVERSE.get(c)
    if (byte === undefined) {
      const cp = text.codePointAt(i) ?? c
      throw new UnencodableCharacterError('windows-1252', String.fromCodePoint(cp), line)
    }
    out[i] = byte
  }
  return out
}

/** Encode editor text for saving in `encoding` (UTF-8 BOM re-added; never written twice). */
export function encodeText(text: string, encoding: TextEncodingId = 'utf8'): Buffer {
  switch (encoding) {
    case 'utf8bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text.replace(/^﻿/, ''), 'utf8')])
    case 'windows-1252':
      return encodeCp1252(text)
    default:
      return Buffer.from(text, 'utf8')
  }
}
