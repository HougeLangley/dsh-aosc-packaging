/**
 * Parsing helpers for AOSC OS / ABBS shell-assignment files (`spec`,
 * `autobuild/defines`) and for Autobuild4 `SRCS` / `CHKSUMS` values.
 *
 * The parser is deliberately forgiving: packaging files are handwritten shell
 * snippets, so a malformed line is reported to the linter (E101/E102) instead
 * of crashing the tool. Only pure syntax helpers live here; no filesystem work.
 */

/** Source types that are fetched by a VCS and therefore do not need a checksum. */
export const VCS_SOURCE_TYPES = new Set(['git', 'hg', 'svn', 'bzr'])

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** @returns {boolean} whether `type` needs a `CHKSUMS` entry. */
export function isVcsSourceType(type) {
  return VCS_SOURCE_TYPES.has(String(type ?? '').toLowerCase())
}

/**
 * Parse a shell assignment file into its variables, start line numbers and
 * malformed lines.
 *
 * Supported forms: `KEY=value`, `KEY="value with spaces"`, literal newlines and
 * `\`-continuations inside double quotes, `KEY='single quoted'`, inline
 * comments, full-line comments and blank lines. Quoted values are unquoted;
 * `$VER` and `${VER}` are preserved verbatim so callers can decide what to do
 * with them.
 *
 * @param {string} text
 * @returns {{ vars: Record<string, string>, lines: Record<string, number>,
 *   malformed: Array<{ line: number, reason: string, text: string }> }}
 */
export function parseAssignments(text) {
  const source = String(text ?? '')
  const physical = source.split(/\r?\n/)
  /** @type {Record<string, string>} */
  const vars = {}
  /** @type {Record<string, number>} */
  const lines = {}
  /** @type {Array<{ line: number, reason: string, text: string }>} */
  const malformed = []

  let index = 0
  while (index < physical.length) {
    const raw = physical[index]
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      index += 1
      continue
    }
    const match = ASSIGNMENT.exec(raw)
    if (!match) {
      malformed.push({ line: index + 1, reason: 'not a shell assignment', text: raw })
      index += 1
      continue
    }
    const key = match[1]
    const startLine = index + 1
    const scanned = scanValue(physical, index, match.index + match[0].length - match[2].length, startLine)
    if (scanned.malformedReason) {
      malformed.push({ line: startLine, reason: scanned.malformedReason, text: raw })
    }
    if (!DANGEROUS_KEYS.has(key)) {
      vars[key] = scanned.value
      lines[key] = startLine
    }
    index = scanned.endLine + 1
  }

  return { vars, lines, malformed }
}

/**
 * Scan one assignment value, following quoted literals across physical lines.
 * @param {string[]} physical
 * @param {number} startIndex
 * @param {number} column
 * @param {number} startLine
 */
function scanValue(physical, startIndex, column, startLine) {
  let value = ''
  let quote = null
  let resumed = false
  let lineIndex = startIndex
  let offset = column
  let malformedReason = null

  for (;;) {
    const line = physical[lineIndex] ?? ''
    let escapedEndOfLine = false

    while (offset < line.length) {
      const ch = line[offset]

      if (quote === "'") {
        if (ch === "'") {
          quote = null
        } else {
          value += ch
        }
        offset += 1
        continue
      }

      if (quote === '"') {
        if (ch === '\\') {
          if (offset === line.length - 1) {
            escapedEndOfLine = true
            offset += 1
            break
          }
          const next = line[offset + 1]
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            value += next
          } else {
            value += ch + next
          }
          offset += 2
          continue
        }
        if (ch === '"') {
          quote = null
          offset += 1
          continue
        }
        value += ch
        offset += 1
        continue
      }

      // Unquoted context.
      if (ch === '#' && offset > 0 && /[ \t]/.test(line[offset - 1])) {
        offset = line.length
        break
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        offset += 1
        continue
      }
      if (ch === '\\') {
        if (offset === line.length - 1) {
          escapedEndOfLine = true
          offset += 1
          break
        }
        value += line[offset + 1]
        offset += 2
        continue
      }
      value += ch
      offset += 1
    }

    if (quote !== null) {
      lineIndex += 1
      if (lineIndex >= physical.length) {
        malformedReason = 'unterminated quoted value'
        break
      }
      if (!escapedEndOfLine) value += '\n'
      offset = 0
      continue
    }

    if (escapedEndOfLine) {
      lineIndex += 1
      if (lineIndex >= physical.length) break
      offset = 0
      continue
    }

    break
  }

  if (!quote) value = value.replace(/[ \t]+$/, '')
  return { value, endLine: lineIndex, malformedReason }
}

/**
 * Split a shell-like list on whitespace, honouring single quotes, double
 * quotes and backslash escapes. Quote characters are removed.
 * @param {string} value
 * @returns {string[]}
 */
export function splitShellList(value) {
  const text = String(value ?? '')
  /** @type {string[]} */
  const tokens = []
  let token = ''
  let quote = null
  let started = false

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]

    if (quote === "'") {
      if (ch === "'") quote = null
      else token += ch
      started = true
      continue
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null
        started = true
        continue
      }
      if (ch === '\\' && index + 1 < text.length) {
        index += 1
        token += text[index]
      } else {
        token += ch
      }
      started = true
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      started = true
      continue
    }
    if (ch === '\\') {
      if (index + 1 < text.length) {
        index += 1
        if (text[index] !== '\n') token += text[index]
      }
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started || token.length > 0) {
        tokens.push(token)
        token = ''
        started = false
      }
      continue
    }
    token += ch
    started = true
  }

  if (started || token.length > 0) tokens.push(token)
  return tokens
}

/**
 * Parse an Autobuild4 `SRCS` value.
 * Accepts `<vcs>::<options>::<uri>`, `<vcs>::<uri>` and `<uri>` forms.
 * @param {string|string[]|null|undefined} srcs
 * @returns {Array<{ type: string, options: Record<string, string|boolean>, uri: string }>}
 */
export function parseSources(srcs) {
  /** @type {string[]} */
  const rawTokens = Array.isArray(srcs)
    ? srcs.flatMap((entry) => splitShellList(entry))
    : splitShellList(srcs)
  /** @type {Array<{ type: string, options: Record<string, string|boolean>, uri: string }>} */
  const sources = []

  for (const token of rawTokens) {
    if (token === '') continue
    const parts = token.split('::')
    const head = parts[0]
    const headIsType = parts.length >= 2 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(head)

    if (headIsType && parts.length >= 3) {
      sources.push({
        type: head.toLowerCase(),
        options: parseSourceOptions(parts[1]),
        uri: parts.slice(2).join('::'),
      })
      continue
    }
    if (headIsType && parts.length === 2) {
      sources.push({ type: head.toLowerCase(), options: {}, uri: parts[1] })
      continue
    }
    sources.push({ type: 'file', options: {}, uri: token })
  }

  return sources
}

/** Parse a `;`-separated Autobuild4 source option list into an object. */
function parseSourceOptions(raw) {
  /** @type {Record<string, string|boolean>} */
  const options = {}
  for (const entry of String(raw ?? '').split(';')) {
    if (entry === '') continue
    const eq = entry.indexOf('=')
    if (eq === -1) {
      if (!DANGEROUS_KEYS.has(entry)) options[entry] = true
      continue
    }
    const key = entry.slice(0, eq)
    const value = entry.slice(eq + 1)
    if (!DANGEROUS_KEYS.has(key)) options[key] = value
  }
  return options
}

/**
 * Parse an ABBS `spec` file.
 * @param {string} text
 */
export function parseSpec(text) {
  const parsed = parseAssignments(text)
  const { vars } = parsed
  const sources = parseSources(vars.SRCS ?? '')
  const chksums = splitShellList(vars.CHKSUMS ?? '')
  const withChecksums = sources.map((source, index) => {
    const checksum = chksums[index] ?? null
    const algorithm = checksum && checksum !== 'SKIP' && checksum.includes('::')
      ? checksum.slice(0, checksum.indexOf('::'))
      : null
    return { ...source, checksum, algorithm }
  })

  return {
    ver: vars.VER ?? null,
    rel: vars.REL ?? null,
    epoch: vars.EPOCH ?? null,
    subdir: vars.SUBDIR ?? null,
    dummysrc: isEnabled(vars.DUMMYSRC),
    sources: withChecksums,
    chksums,
    vars,
    lines: parsed.lines,
    malformed: parsed.malformed,
  }
}

/**
 * Parse an Autobuild4 `autobuild/defines` file.
 * @param {string} text
 */
export function parseDefines(text) {
  const parsed = parseAssignments(text)
  const { vars } = parsed

  return {
    pkgname: vars.PKGNAME ?? null,
    pkgsec: vars.PKGSEC ?? null,
    pkgdes: vars.PKGDES ?? null,
    pkgdep: splitShellList(vars.PKGDEP ?? ''),
    builddep: splitShellList(vars.BUILDDEP ?? ''),
    pkgrecom: splitShellList(vars.PKGRECOM ?? ''),
    pkgbreak: splitShellList(vars.PKGBREAK ?? ''),
    pkgconf: splitShellList(vars.PKGCONFL ?? ''),
    pkgrep: splitShellList(vars.PKGREP ?? ''),
    abtype: vars.ABTYPE ?? null,
    abhost: vars.ABHOST ?? null,
    abstrip: vars.ABSTRIP ?? null,
    vars,
    lines: parsed.lines,
    malformed: parsed.malformed,
  }
}

/** True for the usual shell truthy spellings used in ABBS files. */
export function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

/** True when a `CHKSUMS` entry explicitly skips checksum verification. */
export function isSkipChecksum(value) {
  return String(value ?? '').trim().toUpperCase() === 'SKIP'
}
