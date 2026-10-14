import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseStoredSecret } from '../src/main/services/secret-format.ts'

const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64')

describe('parseStoredSecret', () => {
  it('reads the current {enc, data} entries', () => {
    assert.deepEqual(parseStoredSecret({ enc: true, data: 'abc' }), { enc: true, data: 'abc' })
    assert.deepEqual(parseStoredSecret({ enc: false, data: 'abc' }), { enc: false, data: 'abc' })
    assert.equal(parseStoredSecret({ enc: true }), null)
    assert.equal(parseStoredSecret(null), null)
    assert.equal(parseStoredSecret(''), null)
  })

  it('tells legacy plain values from legacy safeStorage ciphertext', () => {
    assert.deepEqual(parseStoredSecret(b64('sk-ant-api03-THIS-IS-A-TEST-KEY')), { enc: false, data: b64('sk-ant-api03-THIS-IS-A-TEST-KEY') })
    const cipher = b64(Buffer.concat([Buffer.from('v10'), Buffer.from([0x37, 0x57, 0x00, 0x9f, 0xaa])]))
    assert.deepEqual(parseStoredSecret(cipher), { enc: true, data: cipher })
    const cipher11 = b64(Buffer.concat([Buffer.from('v11'), Buffer.from([1, 2, 3, 4])]))
    assert.equal(parseStoredSecret(cipher11)?.enc, true)
  })
})
