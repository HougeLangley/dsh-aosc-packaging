import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as plugin from '../lib/index.js'

const TOOL_NAMES = [
  'aosc_build_plan',
  'aosc_checksum_source',
  'aosc_inspect_package',
  'aosc_lint_package',
  'aosc_scaffold_package',
  'aosc_topic_plan',
]

async function writePackage(t) {
  const root = await mkdtemp(join(tmpdir(), 'aosc-index-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packageDir = join(root, 'hello')
  const files = {
    spec: [
      'VER=2.12.1',
      'SRCS="tbl::https://ftp.gnu.org/gnu/hello/hello-$VER.tar.gz"',
      'CHKSUMS="sha256::0123456789abcdef"',
      '',
    ].join('\n'),
    'autobuild/defines': [
      'PKGNAME=hello',
      'PKGSEC=utils',
      'PKGDES="A hello world demo program"',
      'PKGDEP="glibc"',
      'BUILDDEP=""',
      'ABTYPE=autotools',
      '',
    ].join('\n'),
  }
  for (const [relative, content] of Object.entries(files)) {
    const target = join(packageDir, ...relative.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return packageDir
}

function makeContext() {
  const tools = []
  const effects = []
  const warnings = []
  let disposed = 0
  const ctx = {
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {
          disposed += 1
        }
      },
    },
    effect(callback) {
      const disposer = callback()
      effects.push(disposer)
      return disposer
    },
    get() {
      return undefined
    },
    logger: {
      warn(message) {
        warnings.push(message)
      },
    },
  }
  return { ctx, tools, effects, warnings, disposed: () => disposed }
}

test('the entry exposes the frozen plugin shape', () => {
  assert.equal(plugin.name, 'dsh-aosc-packaging')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply registers all six tools with renders and strict root schemas', async () => {
  const { ctx, tools, effects, disposed } = makeContext()
  await plugin.apply(ctx)

  assert.deepEqual(tools.map((tool) => tool.name).sort(), TOOL_NAMES)
  for (const tool of tools) {
    assert.equal(typeof tool.execute, 'function', `${tool.name} execute`)
    assert.equal(typeof tool.output.render, 'function', `${tool.name} render`)
    assert.equal(tool.output.schema.type, 'object', `${tool.name} root schema`)
    assert.equal(tool.output.schema.additionalProperties, false, `${tool.name} additionalProperties`)
  }
  assert.equal(tools.find((tool) => tool.name === 'aosc_inspect_package').parameters.path.required, true)
  assert.equal(tools.find((tool) => tool.name === 'aosc_checksum_source').parameters.urls.required, true)
  assert.equal(effects.length, 1)
  assert.equal(disposed(), 0)
  assert.doesNotThrow(() => effects[0]())
  assert.equal(disposed(), 6, 'the single effect must dispose all six tool registrations')
})

test('a failing skill registration only warns and keeps the tools alive', async () => {
  const tools = []
  const warnings = []
  const effects = []
  const ctx = {
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {}
      },
    },
    effect(callback) {
      effects.push(callback())
    },
    get(service) {
      if (service !== 'skills') return undefined
      return {
        register() {
          throw new Error('skill service rejected the registration')
        },
      }
    },
    logger: {
      warn(message) {
        warnings.push(message)
      },
    },
  }

  await assert.doesNotReject(() => plugin.apply(ctx))
  assert.deepEqual(tools.map((tool) => tool.name).sort(), TOOL_NAMES)
  assert.ok(warnings.some((warning) => /skill/.test(warning)))
  assert.doesNotThrow(() => effects[0]())
})

test('the runtime skill registers with the contract metadata when present', async (t) => {
  const skillPath = fileURLToPath(new URL('../skills/aosc-packaging/SKILL.md', import.meta.url))
  try {
    await stat(skillPath)
  } catch {
    t.skip('skills/aosc-packaging/SKILL.md is owned by another worker and is not present yet')
    return
  }

  const tools = []
  let skill = null
  let disposed = 0
  const effects = []
  const ctx = {
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {
          disposed += 1
        }
      },
    },
    effect(callback) {
      effects.push(callback())
    },
    get() {
      return {
        register(definition) {
          skill = definition
          return () => {
            disposed += 1
          }
        },
      }
    },
    logger: { warn() {} },
  }

  await plugin.apply(ctx)
  assert.equal(tools.length, 6)
  assert.equal(skill.name, 'aosc-packaging')
  assert.equal(skill.source, 'runtime')
  assert.equal(skill.resourceBase.kind, 'directory')
  assert.equal(
    resolve(skill.resourceBase.path),
    resolve(fileURLToPath(new URL('../skills/aosc-packaging/', import.meta.url))),
    'resourceBase.path must resolve to the skills/aosc-packaging directory on every platform',
  )
  assert.equal(skill.description, 'AOSC OS packaging: ABBS tree, Autobuild4 defines, Ciel BuildKit builds, topic workflow and release checks.')
  assert.equal(skill.whenToUse, 'Use when inspecting, linting, scaffolding or planning AOSC OS .deb packages and ABBS topics.')
  assert.ok(skill.content.length > 500)
  assert.doesNotThrow(() => effects[0]())
  assert.equal(disposed, 7, 'the effect must also dispose the skill registration')
})

test('inspect returns null structures for missing files and throws for a missing path', async (t) => {
  const emptyDir = await mkdtemp(join(tmpdir(), 'aosc-index-empty-'))
  t.after(() => rm(emptyDir, { recursive: true, force: true }))
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)
  const inspect = tools.find((tool) => tool.name === 'aosc_inspect_package')
  const execution = { signal: new AbortController().signal }

  const result = await inspect.execute({ path: emptyDir }, execution)
  assert.equal(result.spec, null)
  assert.equal(result.defines, null)
  assert.equal(result.layout.spec, false)
  assert.equal(result.layout.defines, false)
  assert.deepEqual(result.issues.map((issue) => issue.code).sort(), ['E101', 'E102'])

  const missing = join(emptyDir, 'does-not-exist')
  await assert.rejects(
    () => inspect.execute({ path: missing }, execution),
    (error) => error.message.includes(missing) && error.message.includes('not found'),
  )
})

test('registered tools execute against a real package directory', async (t) => {
  const packageDir = await writePackage(t)
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)
  const execution = { signal: new AbortController().signal }

  const lint = tools.find((tool) => tool.name === 'aosc_lint_package')
  const lintResult = await lint.execute({ path: packageDir }, execution)
  assert.equal(lintResult.ok, true)
  assert.equal(lintResult.errorCount, 0)
  assert.equal(lintResult.path, packageDir)
  const rendered = lint.output.render({ path: packageDir }, lintResult)
  assert.match(rendered[0].text, /OK/)
  assert.match(rendered[0].text, /No issues/)

  const inspect = tools.find((tool) => tool.name === 'aosc_inspect_package')
  const inspectResult = await inspect.execute({ path: packageDir }, execution)
  assert.equal(inspectResult.layout.spec, true)
  assert.equal(inspectResult.layout.defines, true)
  assert.equal(inspectResult.spec.ver, '2.12.1')
  assert.equal(inspectResult.defines.pkgname, 'hello')
  assert.equal(inspectResult.issues.length, 0)

  const topic = tools.find((tool) => tool.name === 'aosc_topic_plan')
  const topicResult = await topic.execute({ packages: ['nano'], kind: 'update', version: '7.2' }, execution)
  assert.equal(topicResult.branch, 'nano-7.2')
  assert.match(topic.output.render({}, topicResult)[0].text, /\/openpr nano: update to 7\.2/)

  const buildPlan = tools.find((tool) => tool.name === 'aosc_build_plan')
  const planResult = await buildPlan.execute({ packages: ['nano'] }, execution)
  assert.equal(planResult.phases.length, 8)
  assert.match(buildPlan.output.render({}, planResult)[0].text, /ciel build -i main nano/)
})
