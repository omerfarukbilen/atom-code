import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, serializeFrontmatter } from '../src/main/services/frontmatter.ts'

test('returns the whole document as body when there is no frontmatter', () => {
  assert.deepEqual(parseFrontmatter('# Title\n\nText'), { data: {}, body: '# Title\n\nText' })
  assert.deepEqual(parseFrontmatter(''), { data: {}, body: '' })
})

test('an unterminated frontmatter block is treated as body', () => {
  const md = '---\nname: x\n# no closing delimiter'
  assert.deepEqual(parseFrontmatter(md), { data: {}, body: md })
})

test('parses simple key/value pairs and keeps the body verbatim', () => {
  const md = '---\nname: systematic-debugging\ndescription: Use when a bug is hard to find.\n---\n\n# Body\n'
  const { data, body } = parseFrontmatter(md)
  assert.deepEqual(data, { name: 'systematic-debugging', description: 'Use when a bug is hard to find.' })
  assert.equal(body, '\n# Body\n')
})

test('handles a UTF-8 BOM, CRLF line endings and the "..." terminator', () => {
  const md = '﻿---\r\nname: crlf\r\nmodel: sonnet\r\n...\r\nBody\r\n'
  const { data, body } = parseFrontmatter(md)
  assert.deepEqual(data, { name: 'crlf', model: 'sonnet' })
  assert.equal(body, 'Body\r\n')
})

test('empty frontmatter', () => {
  assert.deepEqual(parseFrontmatter('---\n---\nhello'), { data: {}, body: 'hello' })
})

test('values containing colons, hyphenated keys and comments', () => {
  const md = [
    '---',
    '# leading comment',
    'description: Use when: the user asks for X # trailing comment',
    'argument-hint: [file] [--watch]',
    'url: https://example.com/a#b',
    'allowed-tools: Bash(git status:*), Read',
    '---',
    ''
  ].join('\n')
  const { data } = parseFrontmatter(md)
  assert.equal(data['description'], 'Use when: the user asks for X')
  assert.equal(data['url'], 'https://example.com/a#b')
  assert.equal(data['allowed-tools'], 'Bash(git status:*), Read')
  // `[file] [--watch]` is not valid flow syntax: the raw text is kept (as in Claude Code command files).
  assert.equal(data['argument-hint'], '[file] [--watch]')
})

test('double and single quoted strings with escapes', () => {
  const md = [
    '---',
    'a: "He said \\"hi\\"\\n\\ttab \\u00e7 \\x41"',
    "b: 'It''s a test: # not a comment'",
    'c: "# not a comment either"',
    "d: ''",
    '---',
    ''
  ].join('\n')
  const { data } = parseFrontmatter(md)
  assert.equal(data['a'], 'He said "hi"\n\ttab ç A')
  assert.equal(data['b'], "It's a test: # not a comment")
  assert.equal(data['c'], '# not a comment either')
  assert.equal(data['d'], '')
})

test('multi-line quoted and plain scalars are folded', () => {
  const md = ['---', 'a: "first line', '  second line"', 'b: plain start', '  continues here', '', '  new paragraph', 'c: end', '---', ''].join('\n')
  const { data } = parseFrontmatter(md)
  assert.equal(data['a'], 'first line second line')
  assert.equal(data['b'], 'plain start continues here\nnew paragraph')
  assert.equal(data['c'], 'end')
})

test('booleans, null-ish values and numbers', () => {
  const md = ['---', 'x: true', 'y: False', 'z: TRUE', 'n: null', 't: ~', 'e:', 'num: 42', 'yes: yes', '---', ''].join('\n')
  const { data } = parseFrontmatter(md)
  assert.deepEqual(data, { x: true, y: false, z: true, n: '', t: '', e: '', num: '42', yes: 'yes' })
})

test('junk after a quoted scalar keeps the raw text', () => {
  const { data } = parseFrontmatter('---\na: "quoted" tail\nb: "ok" # comment\nhint: [message]\n---\n')
  assert.equal(data['a'], '"quoted" tail')
  assert.equal(data['b'], 'ok')
  assert.deepEqual(data['hint'], ['message'])
})

test('flow sequences, including quoted items and multi-line lists', () => {
  const md = ['---', 'tools: [Read, Grep, "Bash(npm test:*)", \'a, b\']', 'empty: []', 'multi: [one,', '  two, three]', '---', ''].join('\n')
  const { data } = parseFrontmatter(md)
  assert.deepEqual(data['tools'], ['Read', 'Grep', 'Bash(npm test:*)', 'a, b'])
  assert.deepEqual(data['empty'], [])
  assert.deepEqual(data['multi'], ['one', 'two', 'three'])
})

test('block sequences, indented or at key level', () => {
  const md = ['---', 'tools:', '  - Read', '  - "Grep"', '  # comment', '  - Bash # trailing', 'skills:', '- a', '- b', 'next: value', '---', ''].join('\n')
  const { data } = parseFrontmatter(md)
  assert.deepEqual(data['tools'], ['Read', 'Grep', 'Bash'])
  assert.deepEqual(data['skills'], ['a', 'b'])
  assert.equal(data['next'], 'value')
})

test('literal block scalars with chomping indicators', () => {
  const md = [
    '---',
    'clip: |',
    '  line one',
    '    indented',
    '',
    '  line three',
    'strip: |-',
    '  no newline',
    'keep: |+',
    '  keep newlines',
    '',
    'after: x',
    '---',
    ''
  ].join('\n')
  const { data } = parseFrontmatter(md)
  assert.equal(data['clip'], 'line one\n  indented\n\nline three\n')
  assert.equal(data['strip'], 'no newline')
  assert.equal(data['keep'], 'keep newlines\n\n')
  assert.equal(data['after'], 'x')
})

test('folded block scalars', () => {
  const md = ['---', 'description: >', '  Use this skill when', '  debugging hard problems.', '', '  Second paragraph.', '    code stays', '  end', 'name: x', '---', ''].join('\n')
  const { data } = parseFrontmatter(md)
  assert.equal(data['description'], 'Use this skill when debugging hard problems.\nSecond paragraph.\n  code stays\nend\n')
  assert.equal(data['name'], 'x')
})

test('folded block with strip chomping and explicit indentation indicator', () => {
  const md = ['---', 'a: >-', '  one', '  two', 'b: |2', '    leading spaces', '---', ''].join('\n')
  const { data } = parseFrontmatter(md)
  assert.equal(data['a'], 'one two')
  assert.equal(data['b'], '  leading spaces\n')
})

test('nested mappings are preserved as dedented text', () => {
  const md = ['---', 'name: x', 'metadata:', '  version: 1.0', '  author: me', 'model: opus', '---', ''].join('\n')
  const { data } = parseFrontmatter(md)
  assert.equal(data['metadata'], 'version: 1.0\nauthor: me')
  assert.equal(data['model'], 'opus')
})

test('serialize produces parseable output that round-trips', () => {
  const data = {
    name: 'my-skill',
    description: 'Use when: things break # really',
    multiline: 'first\n  second\n\nthird\n',
    stripped: 'no trailing newline\nline 2',
    kept: 'kept\n\n',
    indentedFirst: '  starts indented\nnext',
    quoted: 'He said "hi" \\ back',
    tabs: 'a\tb\r\nc',
    empty: '',
    numberLike: '42',
    boolLike: 'true',
    enabled: true,
    disabled: false,
    tools: ['Read', 'Bash(npm test:*)', 'a, b', '- dash', 'true', ''],
    none: [] as string[],
    'odd key': 'value',
    unicode: 'çağrı — ünïcödé ✓'
  }
  const body = '\n# Heading\n\nBody text with --- inside.\n'
  const text = serializeFrontmatter(data, body)
  assert.ok(text.startsWith('---\n'))
  const parsed = parseFrontmatter(text)
  assert.deepEqual(parsed.data, data)
  assert.equal(parsed.body, body)
})

test('serialize skips undefined/null values and returns the body when empty', () => {
  assert.equal(serializeFrontmatter({}, 'body'), 'body')
  assert.equal(serializeFrontmatter({ a: undefined, b: null }, 'body'), 'body')
  assert.equal(serializeFrontmatter({ name: 'x', model: undefined }, 'b'), '---\nname: x\n---\nb')
})

test('serialize output format for common skill fields', () => {
  const text = serializeFrontmatter({ name: 'tdd', description: 'Write tests first.', tools: ['Read', 'Edit'] }, 'Body\n')
  assert.equal(text, '---\nname: tdd\ndescription: Write tests first.\ntools:\n  - Read\n  - Edit\n---\nBody\n')
})
