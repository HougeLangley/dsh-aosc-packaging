import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { lintPackage } from '../lib/lint.js'

const VALID_SPEC = [
  'VER=2.12.1',
  'SRCS="tbl::https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz"',
  'CHKSUMS="sha256::0123456789abcdef"',
  '',
].join('\n')

const VALID_DEFINES = [
  'PKGNAME=hello',
  'PKGSEC=utils',
  'PKGDES="A hello world demo program"',
  'PKGDEP="glibc"',
  'BUILDDEP=""',
  'ABTYPE=autotools',
  '',
].join('\n')

async function makePackage(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aosc-lint-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packageDir = join(root, 'hello')
  const files = {
    spec: VALID_SPEC,
    'autobuild/defines': VALID_DEFINES,
    ...extra,
  }
  for (const [relative, content] of Object.entries(files)) {
    if (content === null) continue
    const target = join(packageDir, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  await mkdir(packageDir, { recursive: true })
  return packageDir
}

function codes(result) {
  return result.issues.map((issue) => issue.code)
}

test('a clean package has no issues', async (t) => {
  const packageDir = await makePackage(t)
  const result = await lintPackage({ dir: packageDir })

  assert.equal(result.path, packageDir)
  assert.equal(result.errorCount, 0)
  assert.equal(result.warningCount, 0)
  assert.equal(result.infoCount, 0)
  assert.equal(result.ok, true)
  assert.deepEqual(result.issues, [])
})

test('lowercase PKGDES triggers L008', async (t) => {
  const packageDir = await makePackage(t, {
    'autobuild/defines': VALID_DEFINES.replace('A hello world demo program', 'a hello world demo program'),
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('L008'))
  assert.equal(result.issues.find((issue) => issue.code === 'L008').severity, 'error')
  assert.equal(result.ok, false)
})

test('missing ABTYPE triggers L010', async (t) => {
  const packageDir = await makePackage(t, {
    'autobuild/defines': VALID_DEFINES.replace('ABTYPE=autotools\n', ''),
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('L010'))
  assert.equal(result.errorCount >= 1, true)
})

test('forge-generated archive URL triggers L005', async (t) => {
  const packageDir = await makePackage(t, {
    spec: [
      'VER=1.0.0',
      'SRCS="tbl::https://github.com/example/hello/archive/v1.0.0.tar.gz"',
      'CHKSUMS="sha256::0123456789abcdef"',
      '',
    ].join('\n'),
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('L005'))
  assert.equal(result.issues.find((issue) => issue.code === 'L005').severity, 'error')
})

test('missing CHKSUMS triggers L003', async (t) => {
  const packageDir = await makePackage(t, {
    spec: [
      'VER=2.12.1',
      'SRCS="tbl::https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz"',
      '',
    ].join('\n'),
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('L003'))
  assert.equal(result.ok, false)
})

test('CHKSUMS=SKIP for a tarball triggers L004', async (t) => {
  const packageDir = await makePackage(t, {
    spec: ['VER=2.12.1', 'SRCS="tbl::https://example.org/hello-$VER.tar.gz"', 'CHKSUMS="SKIP"', ''].join('\n'),
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('L004'))
})

test('invalid PKGNAME triggers E103', async (t) => {
  const packageDir = await makePackage(t, {
    'autobuild/defines': VALID_DEFINES.replace('PKGNAME=hello', 'PKGNAME=Hello_World'),
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('E103'))
  assert.equal(result.errorCount >= 1, true)
})

test('single-character PKGNAME r is legal (p-vector)', async (t) => {
  const packageDir = await makePackage(t, {
    'autobuild/defines': VALID_DEFINES.replace('PKGNAME=hello', 'PKGNAME=r'),
  })
  const result = await lintPackage({ dir: packageDir })

  assert.equal(result.issues.some((issue) => issue.code === 'E103'), false)
  assert.equal(result.ok, true)
})

test('W121 accepts a single-character package name', async (t) => {
  const packageDir = await makePackage(t, {
    'autobuild/defines': VALID_DEFINES.replace('PKGNAME=hello', 'PKGNAME=r'),
  })
  const result = await lintPackage({ dir: packageDir, commitMessage: 'r: update to 1' })

  assert.equal(result.issues.some((issue) => issue.code === 'W121'), false)
  assert.equal(result.ok, true)
})

test('ABTYPE=cargo is rejected; Rust packages use rust', async (t) => {
  const packageDir = await makePackage(t, {
    'autobuild/defines': VALID_DEFINES.replace('ABTYPE=autotools', 'ABTYPE=cargo'),
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('L011'))
  assert.equal(result.issues.find((issue) => issue.code === 'L011').severity, 'error')
})

test('commit message rules W121 and strict mode', async (t) => {
  const packageDir = await makePackage(t)
  const relaxed = await lintPackage({ dir: packageDir, commitMessage: 'Update nano to 7.2' })
  const strict = await lintPackage({ dir: packageDir, commitMessage: 'Update nano to 7.2', strict: true })

  assert.ok(codes(relaxed).includes('W121'))
  assert.equal(relaxed.issues.find((issue) => issue.code === 'W121').file, 'commit')
  assert.equal(relaxed.ok, true)
  assert.equal(strict.ok, false)
})

test('malformed spec lines become E101 issues, not crashes', async (t) => {
  const packageDir = await makePackage(t, {
    spec: 'VER=2.12.1\nthis line is invalid\n',
  })
  const result = await lintPackage({ dir: packageDir })

  const issue = result.issues.find((entry) => entry.code === 'E101' && entry.rule === 'malformed-spec')
  assert.ok(issue)
  assert.equal(issue.line, 2)
  assert.equal(result.errorCount >= 1, true)
})

test('missing spec and defines are E101/E102', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aosc-lint-empty-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = await lintPackage({ dir: root })

  assert.ok(codes(result).includes('E101'))
  assert.ok(codes(result).includes('E102'))
  assert.equal(result.ok, false)
})

test('script, patch and override rules L014/L015/L016 fire', async (t) => {
  const packageDir = await makePackage(t, {
    'autobuild/prepare': '#!/bin/sh\ncp $SRC $DEST\n',
    'autobuild/patches/bad-name.patch': '--- a\n+++ b\n',
    'autobuild/overrides/usr/local/bin/hello': '#!/bin/sh\n',
  })
  const result = await lintPackage({ dir: packageDir })

  const found = codes(result)
  assert.ok(found.includes('L014'))
  assert.ok(found.includes('L015'))
  assert.ok(found.includes('L016'))
})

test('noarch without ABSPLITDBG=0 triggers L018', async (t) => {
  const packageDir = await makePackage(t, {
    'autobuild/defines': `${VALID_DEFINES}ABHOST=noarch\n`,
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('L018'))
})

test('empty SRCS without DUMMYSRC triggers L002', async (t) => {
  const packageDir = await makePackage(t, {
    spec: 'VER=2.12.1\n',
  })
  const result = await lintPackage({ dir: packageDir })

  assert.ok(codes(result).includes('L002'))
})

test('a non-existent package directory throws with the path', async () => {
  const missing = join(tmpdir(), `aosc-lint-missing-${process.pid}-${Date.now()}`)
  await assert.rejects(
    () => lintPackage({ dir: missing }),
    (error) => error.message.includes(missing) && error.message.includes('not found'),
  )
})
