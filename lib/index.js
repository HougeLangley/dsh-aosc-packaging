/**
 * DSH plugin entry for dsh-aosc-packaging.
 *
 * Registers six Host tools plus the optional `aosc-packaging` runtime skill.
 * Every registration is effect-owned; the returned disposers run in reverse
 * order when the effect is disposed by the Host.
 */

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPlan } from './buildplan.js'
import { checksumSources } from './checksum.js'
import { lintPackage, listFiles } from './lint.js'
import { parseDefines, parseSpec } from './parse.js'
import { scaffoldPackage } from './scaffold.js'
import { planTopic } from './topic.js'

export const name = 'dsh-aosc-packaging'
export const inject = ['tools']

const SKILL_DESCRIPTION =
  'AOSC OS packaging: ABBS tree, Autobuild4 defines, Ciel BuildKit builds, topic workflow and release checks.'
const SKILL_WHEN_TO_USE =
  'Use when inspecting, linting, scaffolding or planning AOSC OS .deb packages and ABBS topics.'

/* ------------------------------------------------------------------ schemas */

const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }

const issueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true, description: 'Rule code such as E103, L005 or W121.' },
    severity: { type: 'string', required: true, enum: ['error', 'warning', 'info'] },
    rule: { type: 'string', required: true, description: 'Short stable slug for the rule.' },
    message: { type: 'string', required: true },
    file: { type: 'string', required: true, description: 'File path relative to the package directory.' },
    line: {
      oneOf: [{ type: 'integer' }, { type: 'null' }],
      required: true,
      description: '1-based line number, or null when the issue is not tied to a line.',
    },
    fix: { type: 'string', description: 'Optional one-line remediation.' },
  },
}

const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', required: true, description: 'Source type such as tbl, file, git or hg.' },
    options: { type: 'json', required: true, description: 'Parsed `;`-separated source options.' },
    uri: { type: 'string', required: true },
    checksum: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    algorithm: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
  },
}

const layoutSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    spec: { type: 'boolean', required: true },
    defines: { type: 'boolean', required: true },
    prepare: { type: 'boolean', required: true },
    patch: { type: 'boolean', required: true },
    build: { type: 'boolean', required: true },
    beyond: { type: 'boolean', required: true },
    pax: { type: 'boolean', required: true },
    patches: { type: 'integer', required: true, description: 'Number of files under autobuild/patches/.' },
    overrides: { type: 'integer', required: true, description: 'Number of files under autobuild/overrides/.' },
  },
}

const specSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ver: { ...nullableString, required: true },
        rel: { ...nullableString, required: true },
        epoch: { ...nullableString, required: true },
        subdir: { ...nullableString, required: true },
        dummysrc: { type: 'boolean', required: true },
        sources: { type: 'array', items: sourceSchema, required: true },
        chksums: { type: 'array', items: { type: 'string' }, required: true },
        vars: { type: 'json', required: true },
      },
    },
    { type: 'null' },
  ],
}

const definesSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        pkgname: { ...nullableString, required: true },
        pkgsec: { ...nullableString, required: true },
        pkgdes: { ...nullableString, required: true },
        pkgdep: { type: 'array', items: { type: 'string' }, required: true },
        builddep: { type: 'array', items: { type: 'string' }, required: true },
        pkgrecom: { type: 'array', items: { type: 'string' }, required: true },
        pkgbreak: { type: 'array', items: { type: 'string' }, required: true },
        pkgconf: { type: 'array', items: { type: 'string' }, required: true },
        pkgrep: { type: 'array', items: { type: 'string' }, required: true },
        abtype: { ...nullableString, required: true },
        abhost: { ...nullableString, required: true },
        abstrip: { ...nullableString, required: true },
        vars: { type: 'json', required: true },
      },
    },
    { type: 'null' },
  ],
}

const lintSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    ok: { type: 'boolean', required: true },
    errorCount: { type: 'integer', required: true },
    warningCount: { type: 'integer', required: true },
    infoCount: { type: 'integer', required: true },
    issues: { type: 'array', items: issueSchema, required: true },
  },
}

const inspectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    layout: { ...layoutSchema, required: true },
    spec: { ...specSchema, required: true },
    defines: { ...definesSchema, required: true },
    issues: { type: 'array', items: issueSchema, required: true },
  },
}

const scaffoldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    packageDir: { type: 'string', required: true },
    created: { type: 'array', items: { type: 'string' }, required: true },
    spec: { type: 'string', required: true },
    defines: { type: 'string', required: true },
    lint: { ...lintSchema, required: true },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
  },
}

const checksumSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sources: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          finalUrl: { type: 'string', required: true },
          algorithm: { type: 'string', required: true },
          checksum: { type: 'string', required: true, description: 'Lowercase hexadecimal digest.' },
          size: { type: 'integer', required: true, description: 'Downloaded size in bytes.' },
        },
      },
    },
    chksums: { type: 'string', required: true, description: 'Space-separated `<algorithm>::<hex>` entries.' },
  },
}

const topicSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    branch: { type: 'string', required: true },
    commitMessage: { type: 'string', required: true },
    commitBody: { type: 'string', required: true },
    prTitle: { type: 'string', required: true },
    prBody: { type: 'string', required: true, description: 'Markdown pull-request body.' },
    builditCommands: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        openpr: { type: 'string', required: true },
        pr: { type: 'string', required: true },
        build: { type: 'string', required: true },
      },
    },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
    checklist: { type: 'array', items: { type: 'string' }, required: true },
  },
}

const buildPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prerequisites: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string', required: true },
          purpose: { type: 'string', required: true },
          required: { type: 'boolean', required: true },
        },
      },
    },
    phases: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          commands: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                cmd: { type: 'string', required: true },
                purpose: { type: 'string', required: true },
                optional: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' }, required: true },
    checklist: { type: 'array', items: { type: 'string' }, required: true },
  },
}

/* ------------------------------------------------------------------ helpers */

async function loadDefineTool(ctx) {
  try {
    const module = await import('@deepseek-ai/dsh-tools')
    if (typeof module.defineTool === 'function') return module.defineTool
  } catch (error) {
    const warn = ctx?.logger?.warn
    if (typeof warn === 'function') {
      warn.call(ctx.logger, `aosc-packaging: @deepseek-ai/dsh-tools is unavailable (${error.message}); tool schemas stay uncompiled`)
    }
  }
  return (definition) => definition
}

function resolveUserPath(value, execution) {
  const base = typeof execution?.cwd === 'string'
    ? execution.cwd
    : typeof execution?.workingDirectory === 'string'
      ? execution.workingDirectory
      : process.cwd()
  return path.resolve(base, value)
}

async function readOptionalText(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new Error(`aosc_inspect_package: cannot read ${file}: ${error.message}`)
  }
}

function publicSpec(parsed) {
  return {
    ver: parsed.ver,
    rel: parsed.rel,
    epoch: parsed.epoch,
    subdir: parsed.subdir,
    dummysrc: parsed.dummysrc,
    sources: parsed.sources.map((source) => ({
      type: source.type,
      options: source.options,
      uri: source.uri,
      checksum: source.checksum,
      algorithm: source.algorithm,
    })),
    chksums: parsed.chksums,
    vars: parsed.vars,
  }
}

function publicDefines(parsed) {
  return {
    pkgname: parsed.pkgname,
    pkgsec: parsed.pkgsec,
    pkgdes: parsed.pkgdes,
    pkgdep: parsed.pkgdep,
    builddep: parsed.builddep,
    pkgrecom: parsed.pkgrecom,
    pkgbreak: parsed.pkgbreak,
    pkgconf: parsed.pkgconf,
    pkgrep: parsed.pkgrep,
    abtype: parsed.abtype,
    abhost: parsed.abhost,
    abstrip: parsed.abstrip,
    vars: parsed.vars,
  }
}

async function inspectPackage(packageDir) {
  const absolute = path.resolve(packageDir)
  let info
  try {
    info = await stat(absolute)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`aosc_inspect_package: package directory not found: ${absolute}`)
    }
    throw error
  }
  if (!info.isDirectory()) {
    throw new Error(`aosc_inspect_package: package path is not a directory: ${absolute}`)
  }

  const files = await listFiles(absolute)
  const fileSet = new Set(files)
  const specText = await readOptionalText(path.join(absolute, 'spec'))
  const definesText = await readOptionalText(path.join(absolute, 'autobuild/defines'))
  const spec = specText === null ? null : publicSpec(parseSpec(specText))
  const defines = definesText === null ? null : publicDefines(parseDefines(definesText))
  const lint = await lintPackage({
    dir: absolute,
    specText: specText ?? undefined,
    definesText: definesText ?? undefined,
  })

  return {
    path: absolute,
    layout: {
      spec: fileSet.has('spec'),
      defines: fileSet.has('autobuild/defines'),
      prepare: fileSet.has('autobuild/prepare'),
      patch: fileSet.has('autobuild/patch'),
      build: fileSet.has('autobuild/build'),
      beyond: fileSet.has('autobuild/beyond'),
      pax: fileSet.has('autobuild/pax'),
      patches: files.filter((file) => file.startsWith('autobuild/patches/')).length,
      overrides: files.filter((file) => file.startsWith('autobuild/overrides/')).length,
    },
    spec,
    defines,
    issues: lint.issues,
  }
}

function formatIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return 'No issues.'
  return issues
    .map((issue) => {
      const location = issue.line === null || issue.line === undefined
        ? issue.file
        : `${issue.file}:${issue.line}`
      const fix = issue.fix ? ` (fix: ${issue.fix})` : ''
      return `${issue.severity.toUpperCase()} ${issue.code} ${location} — ${issue.message}${fix}`
    })
    .join('\n')
}

/* ------------------------------------------------------------------- apply */

/**
 * Register the AOSC OS packaging tools and runtime skill.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export async function apply(ctx) {
  const defineTool = await loadDefineTool(ctx)
  /** @type {Array<() => void>} */
  const disposers = []

  disposers.push(ctx.tools.register(defineTool({
    name: 'aosc_inspect_package',
    description: 'Inspect an AOSC OS package directory and report its ABBS layout, parsed spec/defines and lint issues.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Package directory; absolute or relative to the session working directory.',
      },
    },
    output: {
      schema: inspectSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          value.path,
          `layout: spec=${value.layout.spec} defines=${value.layout.defines} patches=${value.layout.patches} overrides=${value.layout.overrides}`,
          `spec: VER=${value.spec?.ver ?? '(missing)'} REL=${value.spec?.rel ?? '(unset)'} sources=${value.spec?.sources.length ?? 0}`,
          `defines: PKGNAME=${value.defines?.pkgname ?? '(missing)'} PKGSEC=${value.defines?.pkgsec ?? '(missing)'} ABTYPE=${value.defines?.abtype ?? '(missing)'}`,
          formatIssues(value.issues),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => inspectPackage(resolveUserPath(args.path, execution)),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'aosc_lint_package',
    description: 'Lint an AOSC OS package directory against the ABBS/Autobuild4 styling rules and return ordered issues.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Package directory; absolute or relative to the session working directory.',
      },
      commitMessage: {
        type: 'string',
        description: 'Optional commit message to check against the W121/W122 rules.',
      },
      strict: {
        type: 'boolean',
        description: 'Treat warnings as a failing result (default false).',
      },
    },
    output: {
      schema: lintSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `${value.path}: ${value.ok ? 'OK' : 'FAILED'} (${value.errorCount} error(s), ${value.warningCount} warning(s), ${value.infoCount} info)`,
          formatIssues(value.issues),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => lintPackage({
      dir: resolveUserPath(args.path, execution),
      commitMessage: args.commitMessage ?? null,
      strict: args.strict === true,
    }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'aosc_scaffold_package',
    description: 'Create a new ABBS package directory with a spec and autobuild/defines, then lint the result.',
    parameters: {
      treeRoot: {
        type: 'string',
        required: true,
        description: 'ABBS tree checkout directory; absolute or relative to the session working directory.',
      },
      pkgname: { type: 'string', required: true, description: 'Lowercase package name.' },
      ver: { type: 'string', required: true, description: 'Upstream version written to VER.' },
      section: { type: 'string', required: true, description: 'Canonical PKGSEC value such as utils or x11.' },
      description: { type: 'string', required: true, description: 'PKGDES text; starts uppercase and has no trailing punctuation.' },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'SRCS entries such as tbl::https://…; defaults to an empty list (DUMMYSRC=1).',
      },
      abtype: { type: 'string', description: 'ABTYPE value; defaults to autotools.' },
      depends: {
        type: 'array',
        items: { type: 'string' },
        description: 'PKGDEP entries; a space-separated string is also accepted.',
      },
      buildDepends: {
        type: 'array',
        items: { type: 'string' },
        description: 'BUILDDEP entries; a space-separated string is also accepted.',
      },
      recommends: {
        type: 'array',
        items: { type: 'string' },
        description: 'PKGRECOM entries; a space-separated string is also accepted.',
      },
      noarch: { type: 'boolean', description: 'Write ABHOST=noarch when true (default false).' },
      rel: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
        description: 'Optional REL value; omitted when null.',
      },
      epoch: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
        description: 'Optional EPOCH value; omitted when null.',
      },
      overwrite: { type: 'boolean', description: 'Rewrite spec/defines when the package directory exists (default false).' },
    },
    output: {
      schema: scaffoldSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Created ${value.created.join(', ')} in ${value.packageDir}`,
          `lint: ${value.lint.ok ? 'OK' : 'FAILED'} (${value.lint.errorCount} error(s), ${value.lint.warningCount} warning(s))`,
          ...value.warnings.map((warning) => `warning: ${warning}`),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => scaffoldPackage({
      ...args,
      treeRoot: resolveUserPath(args.treeRoot, execution),
    }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'aosc_checksum_source',
    description: 'Download each source URL and compute its checksum without writing the file to disk.',
    parameters: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'HTTP(S) URLs to download sequentially.',
      },
      algorithm: {
        type: 'string',
        enum: ['sha256', 'sha512', 'sha1'],
        description: 'Hash algorithm; defaults to sha256.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Per-source timeout in milliseconds; defaults to 20000.',
      },
    },
    output: {
      schema: checksumSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          ...value.sources.map((source) => `${source.algorithm}::${source.checksum}  ${source.finalUrl}  (${source.size} bytes)`),
          '',
          `CHKSUMS="${value.chksums}"`,
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => checksumSources({
      urls: args.urls,
      algorithm: args.algorithm ?? 'sha256',
      timeoutMs: args.timeoutMs ?? 20_000,
      signal: execution?.signal,
    }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'aosc_topic_plan',
    description: 'Plan an AOSC OS topic: branch name, commit message, PR body and BuildIt! commands.',
    parameters: {
      packages: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Package names in build order.',
      },
      kind: {
        type: 'string',
        enum: ['new', 'update', 'security', 'change', 'rebuild', 'drop'],
        description: 'Topic kind; defaults to update.',
      },
      version: { type: 'string', description: 'New upstream version, when the kind uses one.' },
      purpose: { type: 'string', description: 'Change purpose; required for kind=change.' },
      summary: { type: 'string', description: 'Optional commit subject/PR title override.' },
      canonicalPkg: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Canonical package name for multi-package topics.' },
      date: { type: 'string', description: 'YYYY-MM-DD date used by rebuild branches; defaults to today (UTC).' },
      labels: { type: 'array', items: { type: 'string' }, description: 'PR labels; defaults to an empty list.' },
      arch: { type: 'string', description: 'Target architecture appended to /build and /openpr.' },
    },
    output: {
      schema: topicSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `branch: ${value.branch}`,
          `commit: ${value.commitMessage}`,
          `openpr: ${value.builditCommands.openpr}`,
          `build: ${value.builditCommands.build}`,
          ...(value.warnings.length > 0 ? ['warnings:', ...value.warnings.map((warning) => `- ${warning}`)] : []),
        ].join('\n'),
      }],
    },
    execute: async (args) => planTopic(args),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'aosc_build_plan',
    description: 'Plan the Ciel/BuildKit build, test, topic and release commands for AOSC OS packages.',
    parameters: {
      packages: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Package names in build order.',
      },
      instance: { type: 'string', description: 'Ciel instance name; defaults to main.' },
      arch: { type: 'string', description: 'Target architecture for the BuildIt! /build command.' },
      topic: { type: 'string', description: 'Topic branch name; defaults to <first-package>-update.' },
      workspace: {
        type: 'string',
        description: 'Local directory that holds the ABBS checkout; omitted when not used.',
      },
    },
    output: {
      schema: buildPlanSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          ...value.phases.map((phase) => [
            `${phase.name}:`,
            ...phase.commands.map((entry) => `  $ ${entry.cmd}`),
          ].join('\n')),
          '',
          'notes:',
          ...value.notes.map((note) => `- ${note}`),
        ].join('\n'),
      }],
    },
    execute: async (args) => buildPlan(args),
  })))

  // Optional runtime skill: an old Host may not provide `skills`, and a missing
  // skill file must never fail activation.
  try {
    const skills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined
    if (skills) {
      const skillUrl = new URL('../skills/aosc-packaging/SKILL.md', import.meta.url)
      const content = await readFile(skillUrl, 'utf8')
      disposers.push(skills.register({
        name: 'aosc-packaging',
        description: SKILL_DESCRIPTION,
        whenToUse: SKILL_WHEN_TO_USE,
        content,
        source: 'runtime',
        resourceBase: {
          kind: 'directory',
          path: fileURLToPath(new URL('../skills/aosc-packaging/', import.meta.url)),
        },
      }))
    }
  } catch (error) {
    const warn = ctx?.logger?.warn
    if (typeof warn === 'function') {
      warn.call(ctx.logger, `aosc-packaging: runtime skill was not registered (${error.message}); the tools remain available`)
    }
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // A failing disposer must not prevent the remaining ones from running.
      }
    }
  })
}
