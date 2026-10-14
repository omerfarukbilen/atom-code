import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { canonicalWorkspacePath, findProjectConfig, isPathTrusted, resolveInsideWorkspace } from '../src/main/agent/trust.ts'

const root = mkdtempSync(join(tmpdir(), 'atom-trust-'))
after(() => rmSync(root, { recursive: true, force: true }))

function dir(...parts: string[]): string {
  const p = join(root, ...parts)
  mkdirSync(p, { recursive: true })
  return p
}

describe('isPathTrusted', () => {
  it('trusts the folder itself and folders inside it', () => {
    const ws = dir('code', 'app')
    assert.equal(isPathTrusted([ws], ws), true)
    assert.equal(isPathTrusted([ws], join(ws, 'packages', 'core')), true)
    assert.equal(isPathTrusted([`${ws}/`], ws), true)
    assert.equal(isPathTrusted([join(root, 'code')], ws), true)
  })

  it('does not trust siblings that share a name prefix, parents or empty lists', () => {
    const ws = dir('code', 'app')
    assert.equal(isPathTrusted([ws], dir('code', 'app-evil')), false)
    assert.equal(isPathTrusted([ws], join(root, 'code')), false)
    assert.equal(isPathTrusted([], ws), false)
    assert.equal(isPathTrusted(undefined, ws), false)
    assert.equal(isPathTrusted(['', 42, null], ws), false)
  })

  it('matches through symlinks (stored paths are canonical)', () => {
    const real = dir('real-ws')
    const link = join(root, 'linked-ws')
    symlinkSync(real, link)
    assert.equal(canonicalWorkspacePath(link), canonicalWorkspacePath(real))
    assert.equal(isPathTrusted([canonicalWorkspacePath(real)], link), true)
  })
})

describe('findProjectConfig', () => {
  it('is empty for a folder without Claude Code project configuration', () => {
    assert.deepEqual(findProjectConfig(dir('plain', 'repo')), [])
  })

  it('lists .claude, .mcp.json, CLAUDE.md and ATOM.md (dangling links included)', () => {
    const ws = dir('evil', 'repo')
    mkdirSync(join(ws, '.claude'))
    writeFileSync(join(ws, '.mcp.json'), '{}')
    writeFileSync(join(ws, 'CLAUDE.md'), '# rules')
    symlinkSync(join(root, 'does-not-exist'), join(ws, 'ATOM.md'))
    assert.deepEqual(findProjectConfig(ws), ['.claude/', '.mcp.json', 'CLAUDE.md', 'ATOM.md'])
  })

  it('reports CLAUDE.md files of parent folders', () => {
    const parent = dir('mono')
    writeFileSync(join(parent, 'CLAUDE.md'), '# parent rules')
    const ws = dir('mono', 'pkg')
    assert.ok(findProjectConfig(ws).includes(join(parent, 'CLAUDE.md')))
  })
})

describe('resolveInsideWorkspace', () => {
  it('accepts files (and links) that stay inside the workspace', () => {
    const ws = dir('rules-ws')
    writeFileSync(join(ws, 'AGENTS.md'), 'rules')
    symlinkSync(join(ws, 'AGENTS.md'), join(ws, 'ATOM.md'))
    assert.equal(resolveInsideWorkspace(ws, join(ws, 'ATOM.md')), canonicalWorkspacePath(join(ws, 'AGENTS.md')))
  })

  it('rejects links that leave the workspace and missing targets', () => {
    const ws = dir('exfil-ws')
    const secret = join(dir('outside'), 'id_rsa')
    writeFileSync(secret, 'PRIVATE KEY')
    symlinkSync(secret, join(ws, 'ATOM.md'))
    assert.equal(resolveInsideWorkspace(ws, join(ws, 'ATOM.md')), null)
    symlinkSync('/proc/self/environ', join(ws, 'CLAUDE.md'))
    assert.equal(resolveInsideWorkspace(ws, join(ws, 'CLAUDE.md')), null)
    assert.equal(resolveInsideWorkspace(ws, join(ws, 'missing.md')), null)
    assert.equal(resolveInsideWorkspace(ws, ws), null)
  })
})
