/**
 * Static linter for AOSC OS packages in an ABBS tree.
 *
 * Implements the rule table in CONTRACT.md section 5.2. Every issue names the
 * offending file (relative to the package directory) and its line, and every
 * thrown error names the package path so a caller can act on it directly.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import {
  isSkipChecksum,
  isVcsSourceType,
  parseDefines,
  parseSpec,
} from './parse.js'

/**
 * Canonical `PKGSEC` values.
 * Snapshot of https://raw.githubusercontent.com/AOSC-Dev/autobuild4/master/sets/section
 * (main set; `non-free/` and `contrib/` prefixes are accepted around it).
 * Fetch the URL again when Autobuild4 adds a section.
 */
export const PKGSEC_SET = new Set([
  'admin', 'Bases', 'Cinnamon', 'cli-mono', 'comm', 'COSMIC', 'cryptocurrency',
  'Cutefish', 'database', 'debian-installer', 'debug', 'devel', 'doc', 'editors',
  'electronics', 'embedded', 'erlang', 'fonts', 'games', 'gnome', 'gnu-r',
  'gnustep', 'graphics', 'hamradio', 'haskell', 'httpd', 'interpreters', 'java',
  'kde', 'kernel', 'libdevel', 'libs', 'lisp', 'localization', 'LXDE', 'LXQt',
  'MATE', 'mail', 'math', 'metrics', 'misc', 'net', 'news', 'ocaml', 'oldlibs',
  'otherosfs', 'perl', 'php', 'python', 'ros', 'ruby', 'science', 'shells',
  'sound', 'tex', 'text', 'Trinity', 'utils', 'vcs', 'video', 'virtual', 'web',
  'x11', 'xfce', 'zope',
])

/** Known Autobuild4 `ABTYPE` values. */
export const ABTYPE_SET = new Set([
  'self', 'autotools', 'cmake', 'waf', 'plainmake', 'haskell', 'perl', 'python',
  'qtproj', 'ruby', 'gomod', 'rust', 'npm', 'meson',
])

/** Packages that every BuildKit instance already provides. */
export const BUILDKIT_PACKAGES = new Set([
  'gcc', 'g++', 'glibc', 'make', 'cmake', 'autoconf', 'automake', 'libtool',
  'pkgconf', 'pkg-config', 'python-3', 'perl', 'patch', 'bison', 'flex',
  'gettext', 'm4', 'sed', 'gawk', 'tar', 'gzip', 'xz', 'bzip2', 'zstd',
  'ninja', 'meson', 'nasm', 'yasm', 'texinfo', 'help2man', 'coreutils',
  'findutils', 'diffutils', 'grep', 'bash', 'file', 'which', 'util-linux',
  'gperf',
])

const AUTOBUILD_SCRIPTS = ['prepare', 'patch', 'build', 'beyond', 'pax']
const PATCH_NAME = /^[0-9]{4}-/
const PKGNAME_PATTERN = /^[a-z0-9][a-z0-9+.-]*$/
const COMMIT_SUBJECT = /^[a-z0-9][a-z0-9+.-]*: /

/**
 * @typedef {object} Issue
 * @property {string} code
 * @property {'error'|'warning'|'info'} severity
 * @property {string} rule
 * @property {string} message
 * @property {string} file
 * @property {number|null} line
 * @property {string} [fix]
 */

/**
 * Lint one package directory.
 *
 * @param {object} options
 * @param {string} options.dir absolute (or resolvable) package directory
 * @param {string|null} [options.commitMessage]
 * @param {boolean} [options.strict]
 * @param {string} [options.specText] pre-read `spec` contents (optional)
 * @param {string} [options.definesText] pre-read `autobuild/defines` contents
 * @returns {Promise<{ path: string, ok: boolean, errorCount: number,
 *   warningCount: number, infoCount: number, issues: Issue[] }>}
 */
export async function lintPackage({
  dir,
  commitMessage = null,
  strict = false,
  specText,
  definesText,
} = {}) {
  if (typeof dir !== 'string' || dir === '') {
    throw new Error('aosc_lint_package: dir is required and must be a package directory path')
  }
  const packageDir = path.resolve(dir)
  let packageStat
  try {
    packageStat = await stat(packageDir)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`aosc_lint_package: package directory not found: ${packageDir}`)
    }
    throw error
  }
  if (!packageStat.isDirectory()) {
    throw new Error(`aosc_lint_package: package path is not a directory: ${packageDir}`)
  }

  const files = await listFiles(packageDir)
  const fileSet = new Set(files)
  const specSource = specText !== undefined ? specText : await readOptional(path.join(packageDir, 'spec'), packageDir)
  const definesSource = definesText !== undefined
    ? definesText
    : await readOptional(path.join(packageDir, 'autobuild/defines'), packageDir)

  const spec = typeof specSource === 'string' ? parseSpec(specSource) : null
  const defines = typeof definesSource === 'string' ? parseDefines(definesSource) : null

  /** @type {Issue[]} */
  const issues = []
  const add = (code, severity, rule, message, file, line = null, fix = undefined) => {
    const issue = { code, severity, rule, message, file, line }
    if (fix !== undefined) issue.fix = fix
    issues.push(issue)
  }

  // ---------------------------------------------------------------- layout
  if (spec === null) {
    add('E101', 'error', 'missing-spec',
      `Spec file is missing (expected ${path.join(packageDir, 'spec')}).`,
      'spec', 1, 'Create a `spec` file with VER, SRCS and CHKSUMS.')
  } else {
    for (const bad of spec.malformed) {
      add('E101', 'error', 'malformed-spec',
        `Malformed line in spec (${bad.reason}): ${JSON.stringify(bad.text)}`,
        'spec', bad.line, 'Use shell assignments such as `VER=1.2.3`.')
    }
  }
  if (defines === null) {
    add('E102', 'error', 'missing-defines',
      `Defines file is missing (expected ${path.join(packageDir, 'autobuild/defines')}).`,
      'autobuild/defines', 1, 'Create `autobuild/defines` with PKGNAME, PKGSEC, PKGDES and ABTYPE.')
  } else {
    for (const bad of defines.malformed) {
      add('E102', 'error', 'malformed-defines',
        `Malformed line in autobuild/defines (${bad.reason}): ${JSON.stringify(bad.text)}`,
        'autobuild/defines', bad.line, 'Use shell assignments such as `PKGNAME=hello`.')
    }
  }

  // ---------------------------------------------------------------- spec rules
  if (spec !== null) {
    if (!spec.ver) {
      add('L001', 'error', 'missing-ver', 'VER is missing in spec.', 'spec',
        spec.lines.VER ?? 1, 'Set `VER=` to the upstream version.')
    }

    if (spec.sources.length === 0 && !spec.dummysrc) {
      add('L002', 'error', 'missing-sources',
        'Neither SRCS nor DUMMYSRC=1 is declared in spec.', 'spec',
        spec.lines.SRCS ?? spec.lines.DUMMYSRC ?? 1,
        'Add `SRCS=` entries or `DUMMYSRC=1` for a metapackage.')
    }

    for (const [index, source] of spec.sources.entries()) {
      const sourceLine = spec.lines.SRCS ?? 1
      const nonVcs = !isVcsSourceType(source.type)

      if (nonVcs && (spec.chksums[index] === undefined || spec.chksums[index] === '')) {
        add('L003', 'error', 'missing-checksum',
          `SRCS entry #${index + 1} (${source.uri}) has no matching CHKSUMS entry.`,
          'spec', sourceLine, 'Add a `sha256::…` entry in the same position in CHKSUMS.')
      }

      if (nonVcs && isSkipChecksum(spec.chksums[index])) {
        add('L004', 'error', 'checksum-skip',
          `CHKSUMS says SKIP for non-VCS source #${index + 1} (${source.uri}).`,
          'spec', spec.lines.CHKSUMS ?? sourceLine,
          'Replace SKIP with the real sha256 checksum.')
      }

      if (isGeneratedArchiveUrl(source.uri)) {
        add('L005', 'error', 'generated-archive-url',
          `Source ${source.uri} is a forge-generated archive URL; pin an upstream release tarball instead.`,
          'spec', sourceLine,
          'Use the upstream release tarball or a VCS source, not /archive/ or /releases/download/ output.')
      }

      if (/^(http|ftp):\/\//i.test(source.uri)) {
        add('L006', 'warning', 'insecure-source',
          `Source ${source.uri} uses an insecure protocol; prefer https://.`,
          'spec', sourceLine, 'Switch the URL to https:// when the server supports it.')
      }

      if (!/\$VER/.test(source.uri) && hasLiteralVersion(source.uri)) {
        add('L007', 'warning', 'literal-version',
          `Source ${source.uri} contains a literal version number instead of $VER.`,
          'spec', sourceLine, 'Use `$VER` in the URL so the version has one source of truth.')
      }
    }
  }

  // ------------------------------------------------------------- defines rules
  if (defines !== null) {
    const definesLine = (key) => defines.lines[key] ?? 1

    if (!defines.pkgname || !PKGNAME_PATTERN.test(defines.pkgname)) {
      add('E103', 'error', 'invalid-pkgname',
        `PKGNAME ${JSON.stringify(defines.pkgname)} does not match ${PKGNAME_PATTERN}.`,
        'autobuild/defines', definesLine('PKGNAME'),
        'Use lowercase letters, digits, and + . - with a lowercase letter or digit first.')
    }

    if (defines.pkgsec !== null && !isCanonicalSection(defines.pkgsec)) {
      add('E104', 'warning', 'unknown-section',
        `PKGSEC ${JSON.stringify(defines.pkgsec)} is not in the canonical Autobuild4 section set.`,
        'autobuild/defines', definesLine('PKGSEC'),
        'Pick a section from autobuild4/sets/section (non-free/ and contrib/ prefixes are allowed).')
    }

    if (defines.pkgdes !== null) {
      if (/^[a-z]/.test(defines.pkgdes)) {
        add('L008', 'error', 'pkgdes-capitalization',
          'PKGDES starts with a lowercase letter; package descriptions are capitalized.',
          'autobuild/defines', definesLine('PKGDES'), 'Start PKGDES with an uppercase letter.')
      }
      if (/[.!?;,]\s*$/.test(defines.pkgdes)) {
        add('L009', 'warning', 'pkgdes-punctuation',
          'PKGDES ends with punctuation; drop the trailing punctuation.',
          'autobuild/defines', definesLine('PKGDES'), 'Remove the trailing . ! ? ; or ,')
      }
    }

    if (!defines.abtype) {
      add('L010', 'error', 'missing-abtype',
        'ABTYPE is missing; the styling manual requires it explicitly.',
        'autobuild/defines', 1, 'Set ABTYPE to one of the known Autobuild4 build types.')
    } else if (!ABTYPE_SET.has(defines.abtype)) {
      add('L011', 'error', 'unknown-abtype',
        `ABTYPE ${JSON.stringify(defines.abtype)} is not a known Autobuild4 build type.`,
        'autobuild/defines', definesLine('ABTYPE'),
        `Use one of: ${[...ABTYPE_SET].join(', ')}.`)
    }

    const hasBuild = fileSet.has('autobuild/build')
    if (defines.abtype === 'self' && !hasBuild) {
      add('L012', 'error', 'self-build-missing',
        'ABTYPE=self requires an autobuild/build script, but none exists.',
        'autobuild/defines', definesLine('ABTYPE'), 'Add autobuild/build or pick an automatic ABTYPE.')
    }
    if (hasBuild && defines.abtype !== 'self') {
      add('L017', 'warning', 'build-without-self',
        `autobuild/build exists but ABTYPE is ${JSON.stringify(defines.abtype)}; the custom build script is ignored.`,
        'autobuild/build', 1, 'Set ABTYPE=self when using a custom autobuild/build script.')
    }

    for (const dep of defines.builddep) {
      if (BUILDKIT_PACKAGES.has(dep)) {
        add('L013', 'warning', 'builddep-in-buildkit',
          `BUILDDEP lists ${dep}, which is already provided by the BuildKit.`,
          'autobuild/defines', definesLine('BUILDDEP'), `Remove ${dep} from BUILDDEP.`)
      }
    }

    if (defines.abhost === 'noarch' && !isDisabled(defines.vars.ABSPLITDBG)) {
      add('L018', 'warning', 'noarch-splitdbg',
        'ABHOST=noarch requires ABSPLITDBG to be disabled (ABSPLITDBG=0).',
        'autobuild/defines', definesLine('ABHOST'), 'Add `ABSPLITDBG=0`.')
    }

    if (defines.pkgdep.length === 0) {
      add('L019', 'info', 'empty-pkgdep',
        'PKGDEP is empty; this is only legal for meta packages.',
        'autobuild/defines', definesLine('PKGDEP'))
    }
  }

  // ---------------------------------------------------------- patch filenames
  for (const file of files) {
    if (!file.startsWith('autobuild/patches/')) continue
    const name = path.posix.basename(file)
    if (name === '' || !PATCH_NAME.test(name)) {
      add('L014', 'warning', 'patch-name',
        `Patch ${name} does not start with a four-digit sequence (for example 0001-).`,
        file, 1, 'Rename it to `NNNN-<description>.patch`.')
    }
  }

  // ------------------------------------------------------------- overrides
  for (const file of files) {
    const prefix = 'autobuild/overrides/'
    if (!file.startsWith(prefix)) continue
    const target = file.slice(prefix.length)
    if (target === 'usr/local' || target.startsWith('usr/local/')) {
      add('L016', 'error', 'override-usr-local',
        `Override ${target} targets /usr/local; AOSC OS packages install under /usr.`,
        file, 1, 'Move the override to the /usr equivalent.')
    }
  }

  // --------------------------------------------------------- shell scripts
  for (const script of AUTOBUILD_SCRIPTS) {
    const file = `autobuild/${script}`
    if (!fileSet.has(file)) continue
    const content = await readFile(path.join(packageDir, file), 'utf8')
    for (const finding of findUnquotedVariables(content)) {
      add('L015', 'warning', 'unquoted-variable',
        `Shell variable $${finding.variable} is used unquoted in ${file}.`,
        file, finding.line,
        'Quote the expansion (for example "$VAR") to preserve spaces and globbing.')
    }
  }

  // ---------------------------------------------------------- commit message
  if (typeof commitMessage === 'string' && commitMessage.trim() !== '') {
    const subject = commitMessage.split(/\r?\n/, 1)[0].trim()
    if (!COMMIT_SUBJECT.test(subject)) {
      add('W121', 'warning', 'commit-style',
        `Commit subject ${JSON.stringify(subject)} does not match "<package>: <summary>".`,
        'commit', 1, 'Start with the package name, a colon and a space.')
    }
    if (subject.length > 72) {
      add('W122', 'warning', 'commit-subject-length',
        `Commit subject is ${subject.length} characters; keep it at 72 or fewer.`,
        'commit', 1, 'Shorten the subject and move details into the body.')
    }
  }

  issues.sort((a, b) => {
    const byFile = a.file.localeCompare(b.file)
    if (byFile !== 0) return byFile
    const byLine = (a.line ?? 0) - (b.line ?? 0)
    if (byLine !== 0) return byLine
    return a.code.localeCompare(b.code)
  })

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const infoCount = issues.filter((issue) => issue.severity === 'info').length

  return {
    path: packageDir,
    ok: errorCount === 0 && (!strict || warningCount === 0),
    errorCount,
    warningCount,
    infoCount,
    issues,
  }
}

/** True when `section` is canonical, optionally behind non-free/ or contrib/. */
export function isCanonicalSection(section) {
  const value = String(section ?? '')
  const bare = value.replace(/^(non-free|contrib)\//, '')
  return PKGSEC_SET.has(bare)
}

/**
 * Recursively list files below a directory as POSIX relative paths.
 * @param {string} root
 * @param {string} [relative]
 * @returns {Promise<string[]>}
 */
export async function listFiles(root, relative = '') {
  const directory = relative === '' ? root : path.join(root, relative)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  /** @type {string[]} */
  const files = []
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, child))
    } else {
      files.push(child)
    }
  }
  return files
}

async function readOptional(file, packageDir) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new Error(`aosc_lint_package: cannot read ${file} in ${packageDir}: ${error.message}`)
  }
}

/** Detect forge-generated archive URLs (GitHub/GitLab/Bitbucket and friends). */
export function isGeneratedArchiveUrl(uri) {
  let url
  try {
    url = new URL(String(uri))
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  const forge = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|gitea\.com)$/.test(host)
    || host === 'codeload.github.com'
  if (!forge) return false
  const pathname = url.pathname
  return /\/archive\//.test(pathname)
    || /\/-\/archive\//.test(pathname)
    || /\/releases\/download\//.test(pathname)
}

function isDisabled(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value ?? '').toLowerCase())
}

/** True when a version-like token appears in the URL path/query (not its host). */
function hasLiteralVersion(uri) {
  let text = String(uri)
  try {
    const url = new URL(text)
    text = `${url.pathname}${url.search}`
  } catch {
    // Relative or non-URL sources keep the whole string as the haystack.
  }
  return /\d+\.\d+/.test(text)
}

/**
 * Find obviously unquoted `$VAR` expansions in a shell script.
 * Conservative by design: skips `$(...)`, `${...}`, single-quoted strings,
 * double-quoted strings, escaped dollars, assignments and special parameters.
 * @param {string} text
 * @returns {Array<{ line: number, variable: string }>}
 */
export function findUnquotedVariables(text) {
  const findings = []
  const lines = String(text ?? '').split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trimStart()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const seen = new Set()
    let quote = null
    for (let column = 0; column < line.length; column += 1) {
      const ch = line[column]
      if (quote === "'") {
        if (ch === "'") quote = null
        continue
      }
      if (quote === '"') {
        if (ch === '\\') {
          column += 1
          continue
        }
        if (ch === '"') quote = null
        continue
      }
      if (ch === '\\') {
        column += 1
        continue
      }
      if (ch === "'" || ch === '"') {
        quote = ch
        continue
      }
      if (ch === '#' && (column === 0 || /\s/.test(line[column - 1]))) break
      if (ch !== '$') continue

      const next = line[column + 1]
      if (next === '(') {
        column = skipBalanced(line, column + 1, '(', ')')
        continue
      }
      if (next === '{') {
        column = skipBalanced(line, column + 1, '{', '}')
        continue
      }
      if (next === undefined || !/[A-Za-z_]/.test(next)) continue

      let end = column + 1
      while (end < line.length && /[A-Za-z0-9_]/.test(line[end])) end += 1
      const variable = line.slice(column + 1, end)
      const previous = column === 0 ? '' : line[column - 1]
      const following = line[end] ?? ''
      const leftBoundary = previous === '' || /[\s;|&()<>{}\]]/.test(previous)
      const rightBoundary = following === '' || /[\s;|&()<>{}\],]/.test(following)
      if (previous === '=' || !leftBoundary || !rightBoundary) {
        column = end - 1
        continue
      }
      if (!seen.has(variable)) {
        seen.add(variable)
        findings.push({ line: index + 1, variable })
      }
      column = end - 1
    }
  }
  return findings
}

function skipBalanced(text, start, open, close) {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === open) depth += 1
    else if (text[index] === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return text.length
}
