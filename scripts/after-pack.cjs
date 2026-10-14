// electron-builder afterPack hook (see electron-builder.yml).
//
// node-pty 1.1.0 publishes prebuilds/darwin-<arch>/spawn-helper without the execute bit, and
// electron-builder copies file modes as they are. On macOS node-pty posix_spawns that helper for every
// PTY, so without this the integrated terminal and the sign-in flow fall back to plain pipes. Runs
// before code signing, so the signature covers the fixed mode.
const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') return
  const app = `${context.packager.appInfo.productFilename}.app`
  const prebuilds = join(context.appOutDir, app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds')
  if (!existsSync(prebuilds)) return
  for (const dir of readdirSync(prebuilds)) {
    if (!dir.startsWith('darwin-')) continue
    const helper = join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
