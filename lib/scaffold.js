/**
 * Scaffold a new package directory inside an ABBS tree.
 *
 * Validation happens before any filesystem mutation: every problem is collected
 * and reported in one comma-joined error so the caller can fix the whole input
 * in a single pass. The generated `spec` keeps `$VER` literal, writes
 * `CHKSUMS="SKIP"` as an explicit placeholder, and is linted immediately.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ABTYPE_SET, isCanonicalSection, lintPackage } from './lint.js'
import { splitShellList } from './parse.js'

const PKGNAME_PATTERN = /^[a-z0-9][a-z0-9+.-]*$/

/**
 * @param {object} input
 * @param {string} input.treeRoot ABBS tree checkout
 * @param {string} input.pkgname
 * @param {string} input.ver
 * @param {string} input.section
 * @param {string} input.description
 * @param {string[]|string} [input.sources]
 * @param {string} [input.abtype]
 * @param {string[]|string} [input.depends]
 * @param {string[]|string} [input.buildDepends]
 * @param {string[]|string} [input.recommends]
 * @param {boolean} [input.noarch]
 * @param {string|number|null} [input.rel]
 * @param {string|number|null} [input.epoch]
 * @param {boolean} [input.overwrite]
 */
export async function scaffoldPackage(input = {}) {
  const {
    treeRoot,
    pkgname,
    ver,
    section,
    description,
    sources = [],
    abtype = 'autotools',
    depends = [],
    buildDepends = [],
    recommends = [],
    noarch = false,
    rel = null,
    epoch = null,
    overwrite = false,
  } = input

  /** @type {string[]} */
  const problems = []

  if (typeof treeRoot !== 'string' || treeRoot.trim() === '') {
    problems.push('treeRoot is required and must be an absolute or relative directory path')
  }
  if (typeof pkgname !== 'string' || !PKGNAME_PATTERN.test(pkgname)) {
    problems.push(`E103: pkgname ${JSON.stringify(pkgname)} must match ${PKGNAME_PATTERN}`)
  }
  if (typeof ver !== 'string' || ver.trim() === '' || /\s/.test(ver)) {
    problems.push('L001: ver is required and must be a non-empty version string without whitespace')
  }
  if (typeof section !== 'string' || section.trim() === '') {
    problems.push('E104: section is required')
  } else if (!isCanonicalSection(section)) {
    problems.push(`E104: section ${JSON.stringify(section)} is not in the canonical Autobuild4 section set`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    problems.push('L008: description is required')
  } else {
    if (!/^[A-Z]/.test(description)) {
      problems.push('L008: description must start with an uppercase letter')
    }
    if (/[.!?;,]\s*$/.test(description)) {
      problems.push('L009: description must not end with punctuation')
    }
  }
  if (typeof abtype !== 'string' || !ABTYPE_SET.has(abtype)) {
    problems.push(`L011: abtype ${JSON.stringify(abtype)} must be one of: ${[...ABTYPE_SET].join(', ')}`)
  }

  const sourceList = normalizeList(sources, 'sources', problems)
  const dependsList = normalizeList(depends, 'depends', problems)
  const buildDependsList = normalizeList(buildDepends, 'buildDepends', problems)
  const recommendsList = normalizeList(recommends, 'recommends', problems)
  const descriptionText = typeof description === 'string' ? description.trim() : description

  const relProvided = rel !== null && rel !== undefined && rel !== ''
  const epochProvided = epoch !== null && epoch !== undefined && epoch !== ''
  if (relProvided && (typeof rel === 'number' ? !Number.isFinite(rel) : /\s/.test(String(rel)))) {
    problems.push('rel must be a version suffix such as 0 or 1 without whitespace')
  }
  if (epochProvided && (typeof epoch === 'number' ? !Number.isFinite(epoch) : /\s/.test(String(epoch)))) {
    problems.push('epoch must be a non-negative integer without whitespace')
  }

  if (problems.length > 0) {
    const target = typeof treeRoot === 'string' && typeof pkgname === 'string'
      ? path.join(path.resolve(treeRoot), pkgname)
      : String(treeRoot ?? '(unknown tree root)')
    throw new Error(`aosc_scaffold_package: invalid input for ${target}: ${problems.join(', ')}`)
  }

  const packageDir = path.join(path.resolve(treeRoot), pkgname)
  let exists = false
  try {
    const existing = await stat(packageDir)
    exists = true
    if (!existing.isDirectory()) {
      throw new Error(`aosc_scaffold_package: package path exists and is not a directory: ${packageDir}`)
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
  if (exists && overwrite !== true) {
    throw new Error(
      `aosc_scaffold_package: package directory already exists: ${packageDir} (pass overwrite: true to rewrite spec and autobuild/defines)`,
    )
  }

  const specText = buildSpec({ ver, rel: relProvided ? rel : null, epoch: epochProvided ? epoch : null, sources: sourceList })
  const definesText = buildDefines({
    pkgname,
    section,
    description: descriptionText,
    depends: dependsList,
    buildDepends: buildDependsList,
    recommends: recommendsList,
    abtype,
    noarch: noarch === true,
  })

  await mkdir(path.join(packageDir, 'autobuild'), { recursive: true })
  await writeFile(path.join(packageDir, 'spec'), specText, 'utf8')
  await writeFile(path.join(packageDir, 'autobuild/defines'), definesText, 'utf8')

  const lint = await lintPackage({ dir: packageDir })
  const warnings = []
  if (sourceList.length > 0) {
    warnings.push(
      'CHKSUMS="SKIP" is only a placeholder: replace it with the real sha256 of every source before opening a PR (use aosc_checksum_source).',
    )
  } else {
    warnings.push(
      'No sources were provided, so spec uses DUMMYSRC=1; only metapackages that build no code should keep this.',
    )
  }

  return {
    packageDir,
    created: ['spec', 'autobuild/defines'],
    spec: specText,
    defines: definesText,
    lint,
    warnings,
  }
}

function normalizeList(value, field, problems) {
  let entries
  if (value === null || value === undefined || value === '') {
    entries = []
  } else if (Array.isArray(value)) {
    entries = value
  } else if (typeof value === 'string') {
    entries = splitShellList(value)
  } else {
    problems.push(`${field} must be an array or a space-separated string`)
    return []
  }
  /** @type {string[]} */
  const normalized = []
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      problems.push(`${field} entries must be non-empty strings`)
      continue
    }
    normalized.push(entry.trim())
  }
  return normalized
}

function buildSpec({ ver, rel, epoch, sources }) {
  const lines = [`VER=${ver}`]
  if (rel !== null) lines.push(`REL=${rel}`)
  if (epoch !== null) lines.push(`EPOCH=${epoch}`)
  if (sources.length > 0) {
    lines.push(`SRCS="${sources.map(quoteKeepVariables).join(' ')}"`)
    lines.push('CHKSUMS="SKIP"')
  } else {
    lines.push('DUMMYSRC=1')
  }
  return `${lines.join('\n')}\n`
}

function buildDefines({ pkgname, section, description, depends, buildDepends, recommends, abtype, noarch }) {
  const lines = [
    `PKGNAME=${pkgname}`,
    `PKGSEC=${section}`,
    `PKGDES="${escapeDoubleQuoted(description)}"`,
    `PKGDEP="${depends.join(' ')}"`,
    `BUILDDEP="${buildDepends.join(' ')}"`,
    `PKGRECOM="${recommends.join(' ')}"`,
    `ABTYPE=${abtype}`,
  ]
  if (noarch) lines.push('ABHOST=noarch')
  return `${lines.join('\n')}\n`
}

/** Escape quotes/backslashes but keep `$VER` and other variables literal. */
function quoteKeepVariables(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Escape a value so double-quoted shell assignment yields the original text. */
function escapeDoubleQuoted(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}
