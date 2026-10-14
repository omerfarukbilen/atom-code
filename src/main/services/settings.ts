import { app, ipcMain, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../../shared/defaults'
import { IPC } from '../../shared/ipc'
import type { AppSettings, DeepPartial } from '../../shared/types'
import { ctx } from '../context'
import { parseStoredSecret, type SecretName, type StoredSecret } from './secret-format'

export type { SecretName } from './secret-format'

/** How credentials are stored right now (shown in the account UI). */
export interface SecretStorageState {
  encrypted: boolean
  backend?: string
  file: string
  /** Secrets kept on disk that cannot be decrypted in this session (keyring unavailable). */
  locked: SecretName[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep merge where arrays and primitives in `patch` replace values in `base`. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : (patch as T))
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

class SettingsService {
  private settings: AppSettings = DEFAULT_SETTINGS
  private secrets: Partial<Record<SecretName, string>> = {}
  /** Encrypted entries the keyring of this session cannot decrypt: kept verbatim, never used. */
  private lockedSecrets: Partial<Record<SecretName, StoredSecret>> = {}
  private listeners = new Set<(s: AppSettings) => void>()
  private writeChain: Promise<void> = Promise.resolve()

  private get dir(): string {
    return app.getPath('userData')
  }
  private get file(): string {
    return join(this.dir, 'settings.json')
  }
  private get secretsFile(): string {
    return join(this.dir, 'secrets.json')
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(await readFile(this.file, 'utf8')) as unknown
        this.settings = deepMerge(DEFAULT_SETTINGS, raw)
        this.settings.version = SETTINGS_VERSION
      }
    } catch (err) {
      console.error('[settings] failed to read settings, using defaults', err)
      this.settings = DEFAULT_SETTINGS
    }
    try {
      if (existsSync(this.secretsFile)) {
        const raw = JSON.parse(await readFile(this.secretsFile, 'utf8')) as Record<string, unknown>
        const canDecrypt = safeStorage.isEncryptionAvailable()
        let upgrade = false
        for (const [key, value] of Object.entries(raw)) {
          if (key !== 'anthropicApiKey' && key !== 'claudeOAuthToken') continue
          const name: SecretName = key
          const stored = parseStoredSecret(value)
          if (!stored) continue
          if (!stored.enc) {
            this.secrets[name] = Buffer.from(stored.data, 'base64').toString('utf8')
            // Saved while no keyring was available, or by an older version: encrypt it now that one is.
            if (canDecrypt || typeof value === 'string') upgrade = true
            continue
          }
          if (!canDecrypt) {
            this.lockedSecrets[name] = stored
            continue
          }
          try {
            this.secrets[name] = safeStorage.decryptString(Buffer.from(stored.data, 'base64'))
            if (typeof value === 'string') upgrade = true
          } catch {
            // Encrypted with a key this keyring does not have (another machine/profile): keep it, unused.
            this.lockedSecrets[name] = stored
          }
        }
        if (upgrade) await this.writeSecrets().catch(() => undefined)
      }
    } catch (err) {
      console.error('[settings] failed to read secrets', err)
    }
  }

  get(): AppSettings {
    return this.settings
  }

  async update(patch: DeepPartial<AppSettings>): Promise<AppSettings> {
    this.settings = deepMerge(this.settings, patch)
    await this.persist()
    this.emit()
    return this.settings
  }

  async reset(): Promise<AppSettings> {
    // Keep the user's workspace history across a reset.
    const { recentWorkspaces, lastWorkspace } = this.settings
    this.settings = { ...DEFAULT_SETTINGS, recentWorkspaces, lastWorkspace }
    await this.persist()
    this.emit()
    return this.settings
  }

  onChange(cb: (s: AppSettings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getSecret(name: SecretName): string | undefined {
    return this.secrets[name]
  }

  /** Whether stored secrets are encrypted, by which backend, where, and which cannot be decrypted now. */
  getSecretStorageState(): SecretStorageState {
    let backend: string | undefined
    try {
      // Linux only: which secret store Chromium picked ("basic_text" = none).
      if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
        backend = safeStorage.getSelectedStorageBackend()
      }
    } catch {
      backend = undefined
    }
    return {
      encrypted: safeStorage.isEncryptionAvailable(),
      ...(backend ? { backend } : {}),
      file: this.secretsFile,
      locked: (Object.keys(this.lockedSecrets) as SecretName[]).filter((n) => !this.secrets[n])
    }
  }

  async setSecret(name: SecretName, value: string | null): Promise<void> {
    if (value) this.secrets[name] = value
    else delete this.secrets[name]
    // A new value (or clearing it) replaces a locked one.
    delete this.lockedSecrets[name]
    await this.writeSecrets()
  }

  private async writeSecrets(): Promise<void> {
    const encrypt = safeStorage.isEncryptionAvailable()
    const out: Partial<Record<SecretName, StoredSecret>> = { ...this.lockedSecrets }
    for (const [k, v] of Object.entries(this.secrets) as [SecretName, string | undefined][]) {
      if (!v) continue
      out[k] = encrypt
        ? { enc: true, data: safeStorage.encryptString(v).toString('base64') }
        : { enc: false, data: Buffer.from(v, 'utf8').toString('base64') }
    }
    await this.atomicWrite(this.secretsFile, JSON.stringify(out, null, 2))
  }

  private emit(): void {
    for (const l of this.listeners) l(this.settings)
    ctx.send(IPC.settingsChangedEvent, this.settings)
  }

  private persist(): Promise<void> {
    const data = JSON.stringify(this.settings, null, 2)
    this.writeChain = this.writeChain.then(() => this.atomicWrite(this.file, data)).catch((err) => {
      console.error('[settings] write failed', err)
    })
    return this.writeChain
  }

  private async atomicWrite(file: string, data: string): Promise<void> {
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, file)
  }
}

export const settingsService = new SettingsService()

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => settingsService.get())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: DeepPartial<AppSettings>) => settingsService.update(patch))
  ipcMain.handle(IPC.settingsReset, () => settingsService.reset())
}
