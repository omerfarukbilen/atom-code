/**
 * The on-disk format of ATOM Code's stored credentials (secrets.json). Pure, unit tested.
 */

export type SecretName = 'anthropicApiKey' | 'claudeOAuthToken'

/**
 * One entry of secrets.json. `enc` records how `data` (base64) was written — with the OS keyring
 * (safeStorage) or as plain UTF-8 when no keyring was available — so a later launch never feeds
 * ciphertext to Claude Code as a credential (or drops a plain value) when keyring availability changes.
 * Files from older versions hold bare base64 strings (see `parseStoredSecret`).
 */
export interface StoredSecret {
  enc: boolean
  data: string
}

/** Decode a secrets.json value (current `{enc, data}` objects and legacy bare base64 strings). */
export function parseStoredSecret(value: unknown): StoredSecret | null {
  if (typeof value === 'string') {
    if (!value) return null
    // Legacy: encrypted values are safeStorage blobs ("v10"/"v11" prefix); plain ones are the secret itself.
    const head = Buffer.from(value.slice(0, 8), 'base64').toString('latin1')
    return { enc: /^v1\d/.test(head), data: value }
  }
  if (typeof value === 'object' && value !== null) {
    const v = value as { enc?: unknown; data?: unknown }
    if (typeof v.data === 'string' && v.data) return { enc: v.enc === true, data: v.data }
  }
  return null
}
