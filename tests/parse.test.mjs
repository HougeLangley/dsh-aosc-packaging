import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseDefines,
  parseSpec,
  splitShellList,
  parseSources,
} from '../lib/parse.js'

const SPEC = [
  '# full-line comment',
  'VER=1.2.3',
  'REL=2   # trailing comment',
  'KEY_SPACES="value with spaces"',
  "SINGLE='single value'",
  'SRCS="tbl::https://example.org/hello-$VER.tar.gz \\',
  '      tbl::https://example.org/extra-$VER.tar.gz"',
  'CHKSUMS="sha256::aaa \\',
  '         sha256::bbb"',
  'COMMENTED=value # trailing comment',
  'EMPTY=',
].join('\n')

test('parseSpec handles comments, quotes, continuations and checksums', () => {
  const parsed = parseSpec(SPEC)

  assert.equal(parsed.ver, '1.2.3')
  assert.equal(parsed.rel, '2')
  assert.equal(parsed.epoch, null)
  assert.equal(parsed.dummysrc, false)
  assert.equal(parsed.vars.KEY_SPACES, 'value with spaces')
  assert.equal(parsed.vars.SINGLE, 'single value')
  assert.equal(parsed.vars.COMMENTED, 'value')
  assert.equal(parsed.vars.EMPTY, '')
  assert.equal(parsed.lines.VER, 2)
  assert.equal(parsed.lines.SRCS, 6)
  assert.equal(parsed.lines.CHKSUMS, 8)
  assert.deepEqual(parsed.malformed, [])

  assert.equal(parsed.sources.length, 2)
  assert.equal(parsed.sources[0].type, 'tbl')
  assert.deepEqual(parsed.sources[0].options, {})
  assert.equal(parsed.sources[0].uri, 'https://example.org/hello-$VER.tar.gz')
  assert.equal(parsed.sources[0].checksum, 'sha256::aaa')
  assert.equal(parsed.sources[0].algorithm, 'sha256')
  assert.equal(parsed.sources[1].uri, 'https://example.org/extra-$VER.tar.gz')
  assert.deepEqual(parsed.chksums, ['sha256::aaa', 'sha256::bbb'])
})

test('parseSources understands vcs options, bare URLs and SKIP', () => {
  const sources = parseSources(
    'git::commit=abc123;branch=main::https://github.com/foo/bar.git file::https://example.org/x.tar.gz',
  )
  assert.equal(sources[0].type, 'git')
  assert.equal(sources[0].options.commit, 'abc123')
  assert.equal(sources[0].options.branch, 'main')
  assert.equal(sources[0].uri, 'https://github.com/foo/bar.git')
  assert.equal(sources[1].type, 'file')
  assert.equal(sources[1].uri, 'https://example.org/x.tar.gz')

  const parsed = parseSpec('VER=1\nSRCS="git::https://example.org/repo.git"\nCHKSUMS="SKIP"\n')
  assert.equal(parsed.sources[0].type, 'git')
  assert.equal(parsed.sources[0].checksum, 'SKIP')
  assert.equal(parsed.sources[0].algorithm, null)
})

test('splitShellList is quote aware', () => {
  assert.deepEqual(splitShellList('a "b c" d'), ['a', 'b c', 'd'])
  assert.deepEqual(splitShellList("a 'b c'"), ['a', 'b c'])
  assert.deepEqual(splitShellList('   '), [])
})

test('parseSpec handles DUMMYSRC and reports malformed lines', () => {
  const dummy = parseSpec('VER=1\nDUMMYSRC=1\n')
  assert.equal(dummy.dummysrc, true)
  assert.deepEqual(dummy.sources, [])

  const malformed = parseSpec('VER=1\nthis is not an assignment\nSRCS="x"\n')
  assert.equal(malformed.malformed.length, 1)
  assert.equal(malformed.malformed[0].line, 2)
  assert.equal(malformed.ver, '1')
})

test('parseDefines exposes the Autobuild4 fields', () => {
  const parsed = parseDefines([
    'PKGNAME=hello',
    'PKGSEC=utils',
    'PKGDES="A hello world demo program"',
    'PKGDEP="glibc zlib"',
    'BUILDDEP=""',
    'PKGRECOM="cowsay"',
    'PKGCONFL="hello-old"',
    'PKGREP="hello-old"',
    'ABTYPE=autotools',
    'ABHOST=noarch',
    'ABSPLITDBG=0',
  ].join('\n'))

  assert.equal(parsed.pkgname, 'hello')
  assert.equal(parsed.pkgsec, 'utils')
  assert.equal(parsed.pkgdes, 'A hello world demo program')
  assert.deepEqual(parsed.pkgdep, ['glibc', 'zlib'])
  assert.deepEqual(parsed.builddep, [])
  assert.deepEqual(parsed.pkgrecom, ['cowsay'])
  assert.deepEqual(parsed.pkgconf, ['hello-old'])
  assert.deepEqual(parsed.pkgrep, ['hello-old'])
  assert.equal(parsed.abtype, 'autotools')
  assert.equal(parsed.abhost, 'noarch')
  assert.equal(parsed.abstrip, null)
  assert.equal(parsed.vars.ABSPLITDBG, '0')
})
