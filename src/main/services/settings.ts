import { app, ipcMain, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../../shared/defaults'
import { IPC } from '../../shared/ipc'
import type { AppSettings, DeepPartial } from '../../shared/types'
import { ctx } from '../context'

type SecretName = 'anthropicApiKey' | 'claudeOAuthToken'

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
        const raw = JSON.parse(await readFile(this.secretsFile, 'utf8')) as Record<string, string>
        for (const [name, value] of Object.entries(raw)) {
          if (!value) continue
          try {
            this.secrets[name as SecretName] = safeStorage.isEncryptionAvailable()
              ? safeStorage.decryptString(Buffer.from(value, 'base64'))
              : Buffer.from(value, 'base64').toString('utf8')
          } catch {
            /* unreadable secret — ignore */
          }
        }
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

  async setSecret(name: SecretName, value: string | null): Promise<void> {
    if (value) this.secrets[name] = value
    else delete this.secrets[name]
    const encoded: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.secrets)) {
      if (!v) continue
      encoded[k] = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(v).toString('base64')
        : Buffer.from(v, 'utf8').toString('base64')
    }
    await this.atomicWrite(this.secretsFile, JSON.stringify(encoded, null, 2))
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
