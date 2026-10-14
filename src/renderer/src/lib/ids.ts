/** RFC 4122 v4 uuid (crypto.randomUUID is available in Chromium). */
export function uuid(): string {
  return crypto.randomUUID()
}
