/**
 * node-pty 1.1.0 publishes `prebuilds/darwin-<arch>/spawn-helper` without the execute bit. On macOS
 * node-pty posix_spawns that helper for every PTY, so the terminal and the sign-in flow would fail with
 * "posix_spawnp failed." and drop to the pipe fallback (no TTY: no vim/less/pager, password prompts,
 * completion…). The `postinstall` script and the electron-builder `afterPack` hook fix the mode at
 * install/package time; this is the runtime fallback for installs where neither ran.
 */
import { accessSync, chmodSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { unpackedPath } from '../context'

let checked = false

/** Make node-pty's macOS spawn helper executable when it is not (once per process; never throws). */
export function ensurePtySpawnHelperExecutable(): void {
  if (checked || process.platform !== 'darwin') return
  checked = true
  let pkgDir: string
  try {
    pkgDir = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'))
  } catch {
    return
  }
  for (const rel of [join('prebuilds', `darwin-${process.arch}`, 'spawn-helper'), join('build', 'Release', 'spawn-helper')]) {
    const helper = unpackedPath(join(pkgDir, rel))
    if (!existsSync(helper)) continue
    try {
      accessSync(helper, constants.X_OK)
      continue
    } catch {
      /* not executable: fix it below */
    }
    try {
      chmodSync(helper, 0o755)
    } catch (err) {
      console.warn(`[pty] ${helper} is not executable and could not be fixed (${err instanceof Error ? err.message : String(err)}); terminals will use pipes.`)
    }
  }
}
