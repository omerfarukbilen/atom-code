import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCmdShimTarget } from '../src/main/services/cmd-shim.ts'

// What npm (cmd-shim) writes for a global `npm i -g @anthropic-ai/claude-code`.
const SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ''
].join('\r\n')

describe('parseCmdShimTarget', () => {
  it('finds the script an npm shim runs (not node.exe)', () => {
    assert.equal(parseCmdShimTarget(SHIM), 'node_modules\\@anthropic-ai\\claude-code\\cli.js')
  })

  it('finds a native executable target and the old %~dp0 form', () => {
    assert.equal(parseCmdShimTarget('"%~dp0\\node_modules\\pkg\\bin\\claude.exe"   %*'), 'node_modules\\pkg\\bin\\claude.exe')
  })

  it('returns null for anything else', () => {
    assert.equal(parseCmdShimTarget('@echo off\r\nclaude.exe %*'), null)
    assert.equal(parseCmdShimTarget(''), null)
  })
})
