import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { scaffoldPackage } from '../lib/scaffold.js'

async function makeTree(t) {
  const root = await mkdtemp(join(tmpdir(), 'aosc-scaffold-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('scaffolds spec and defines with real content', async (t) => {
  const treeRoot = await makeTree(t)
  const result = await scaffoldPackage({
    treeRoot,
    pkgname: 'hello',
    ver: '2.12.1',
    section: 'utils',
    description: 'A hello world demo program',
    sources: ['tbl::https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz'],
    abtype: 'autotools',
    depends: ['glibc'],
    buildDepends: [],
    recommends: [],
    noarch: false,
    rel: 0,
    epoch: null,
  })

  assert.equal(result.packageDir, join(treeRoot, 'hello'))
  assert.deepEqual(result.created, ['spec', 'autobuild/defines'])
  assert.equal(result.spec, [
    'VER=2.12.1',
    'REL=0',
    'SRCS="tbl::https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz"',
    'CHKSUMS="SKIP"',
    '',
  ].join('\n'))
  assert.equal(result.defines, [
    'PKGNAME=hello',
    'PKGSEC=utils',
    'PKGDES="A hello world demo program"',
    'PKGDEP="glibc"',
    'BUILDDEP=""',
    'PKGRECOM=""',
    'ABTYPE=autotools',
    '',
  ].join('\n'))
  assert.equal((await stat(result.packageDir)).isDirectory(), true)

  const onDiskSpec = await readFile(join(result.packageDir, 'spec'), 'utf8')
  const onDiskDefines = await readFile(join(result.packageDir, 'autobuild/defines'), 'utf8')
  assert.equal(onDiskSpec, result.spec)
  assert.equal(onDiskDefines, result.defines)

  assert.equal(result.lint.errorCount >= 1, true)
  assert.ok(result.lint.issues.some((issue) => issue.code === 'L004'))
  assert.match(result.warnings[0], /CHKSUMS/)
})

test('no sources generate DUMMYSRC=1 and no CHKSUMS', async (t) => {
  const treeRoot = await makeTree(t)
  const result = await scaffoldPackage({
    treeRoot,
    pkgname: 'meta-pkg',
    ver: '1',
    section: 'utils',
    description: 'A meta package',
    noarch: true,
  })

  assert.match(result.spec, /^VER=1$/m)
  assert.match(result.spec, /^DUMMYSRC=1$/m)
  assert.doesNotMatch(result.spec, /^CHKSUMS=/m)
  assert.match(result.defines, /^ABHOST=noarch$/m)
  assert.match(result.warnings[0], /DUMMYSRC/)
})

test('an existing package directory is refused unless overwrite is true', async (t) => {
  const treeRoot = await makeTree(t)
  const input = {
    treeRoot,
    pkgname: 'twice',
    ver: '1.0',
    section: 'utils',
    description: 'A twice-created package',
    sources: ['tbl::https://example.org/twice-$VER.tar.gz'],
  }

  await scaffoldPackage(input)
  await assert.rejects(
    () => scaffoldPackage(input),
    (error) => error.message.includes('already exists') && error.message.includes(join(treeRoot, 'twice')),
  )
  const overwritten = await scaffoldPackage({ ...input, overwrite: true, ver: '1.1' })
  assert.match(overwritten.spec, /^VER=1\.1$/m)
})

test('invalid input is rejected in one comma-joined error before touching disk', async (t) => {
  const treeRoot = await makeTree(t)
  let error
  try {
    await scaffoldPackage({
      treeRoot,
      pkgname: 'Bad_Name',
      ver: '',
      section: 'not-a-section',
      description: 'lowercase and punctuated.',
      abtype: 'nonsense',
    })
  } catch (caught) {
    error = caught
  }

  assert.ok(error instanceof Error)
  assert.match(error.message, /pkgname/)
  assert.match(error.message, /section/)
  assert.match(error.message, /description/)
  assert.match(error.message, /abtype/)
  await assert.rejects(() => stat(join(treeRoot, 'Bad_Name')))
})

test('space-separated dependency strings are accepted', async (t) => {
  const treeRoot = await makeTree(t)
  const result = await scaffoldPackage({
    treeRoot,
    pkgname: 'deps-demo',
    ver: '2',
    section: 'utils',
    description: 'A dependency demo package',
    sources: 'tbl::https://example.org/deps-demo-$VER.tar.gz',
    depends: 'glibc zlib',
    buildDepends: 'cmake ninja',
    recommends: 'cowsay fortune',
  })

  assert.match(result.defines, /^PKGDEP="glibc zlib"$/m)
  assert.match(result.defines, /^BUILDDEP="cmake ninja"$/m)
  assert.match(result.defines, /^PKGRECOM="cowsay fortune"$/m)
})

test('single-character package names are accepted', async (t) => {
  const treeRoot = await makeTree(t)
  const result = await scaffoldPackage({
    treeRoot,
    pkgname: 'r',
    ver: '1',
    section: 'utils',
    description: 'A single-letter runtime package',
  })

  assert.equal(result.packageDir, join(treeRoot, 'r'))
  assert.match(result.defines, /^PKGNAME=r$/m)
})
