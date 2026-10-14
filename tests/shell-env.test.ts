import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergePaths, parseShellPath, shouldResolveShellPath } from '../src/main/services/shell-env.ts'

describe('login shell PATH', () => {
  it('extracts the PATH between the markers, ignoring rc-file noise', () => {
    const out = 'Welcome!\n__ATOM_PATH_START__\n/opt/homebrew/bin:/usr/bin:/bin\n__ATOM_PATH_END__\nbye\n'
    assert.equal(parseShellPath(out), '/opt/homebrew/bin:/usr/bin:/bin')
    assert.equal(parseShellPath('no markers'), null)
    assert.equal(parseShellPath('__ATOM_PATH_START__\n/usr/bin'), null)
    assert.equal(parseShellPath('__ATOM_PATH_START__\n\n__ATOM_PATH_END__'), null)
  })

  it('puts login-shell entries first and keeps entries only the current PATH has', () => {
    assert.equal(
      mergePaths('/opt/homebrew/bin:/Users/me/.nvm/bin:/usr/bin', '/usr/bin:/bin:/custom', ':'),
      '/opt/homebrew/bin:/Users/me/.nvm/bin:/usr/bin:/bin:/custom'
    )
    assert.equal(mergePaths('/a::/b', undefined, ':'), '/a:/b')
  })

  it('resolves on macOS always and on Linux only outside a terminal', () => {
    assert.equal(shouldResolveShellPath('darwin', true), true)
    assert.equal(shouldResolveShellPath('linux', false), true)
    assert.equal(shouldResolveShellPath('linux', true), false)
    assert.equal(shouldResolveShellPath('win32', false), false)
  })
})
