/**
 * Plan an AOSC OS topic: branch name, commit message, PR description and
 * BuildIt! chat commands. Inputs are plain JSON; nothing here touches the
 * filesystem or the network.
 */

export const TOPIC_KINDS = new Set(['new', 'update', 'security', 'change', 'rebuild', 'drop'])

const CHECKLIST = [
  'Changes follow the AOSC OS styling manual (spec/defines conventions and commit format).',
  'Every package was built in its own clean BuildKit instance.',
  'The topic branch was rebased on `stable` and merged through BuildIt! after review.',
  '`stable` was rebuilt after merge and every updated package is available from the repository.',
]

/**
 * @param {object} input
 * @param {string[]} input.packages package names in build order
 * @param {'new'|'update'|'security'|'change'|'rebuild'|'drop'} [input.kind]
 * @param {string} [input.version]
 * @param {string} [input.purpose] required for `change`
 * @param {string} [input.summary] overrides the generated commit subject
 * @param {string|null} [input.canonicalPkg] canonical name for multi-package topics
 * @param {string} [input.date] YYYY-MM-DD, used by `rebuild`
 * @param {string[]} [input.labels]
 * @param {string} [input.arch]
 */
export function planTopic(input = {}) {
  const packages = normalizePackages(input.packages)
  const kind = input.kind ?? 'update'
  if (!TOPIC_KINDS.has(kind)) {
    throw new Error(
      `aosc_topic_plan: kind ${JSON.stringify(kind)} is not supported (use ${[...TOPIC_KINDS].join(', ')})`,
    )
  }

  const first = packages[0]
  const multi = packages.length > 1
  const version = toText(input.version)
  const purpose = toText(input.purpose)
  const canonicalPkg = toText(input.canonicalPkg)
  const arch = toText(input.arch)
  const labels = normalizeLabels(input.labels)
  const date = normalizeDate(input.date)
  const base = canonicalPkg || first

  /** @type {string[]} */
  const warnings = []
  if (multi && canonicalPkg === null && kind !== 'rebuild') {
    warnings.push(
      `This topic builds ${packages.length} packages; pass canonicalPkg so the branch and commit use the canonical package name (falling back to ${first}).`,
    )
  }

  const branch = topicBranch(kind, { base, version, purpose, date })
  if (['new', 'update', 'security'].includes(kind) && version === null) {
    warnings.push(`${kind} topics normally include a version; the branch and commit cannot name one.`)
  }
  if (kind === 'change' && purpose === null) {
    warnings.push('change topics need a purpose; the branch and commit fall back to "change".')
  }

  const generatedSubject = topicSubject(kind, { base, version, purpose })
  const commitMessage = toText(input.summary) || generatedSubject
  const prTitle = commitMessage
  const commitBody = topicCommitBody(kind, { base, packages, version, purpose, branch })
  const checklist = [...CHECKLIST]
  const prBody = topicPrBody(kind, { base, packages, version, purpose, branch, checklist })
  const builditCommands = {
    openpr: openprCommand({ title: commitMessage, branch, packages, labels, arch }),
    pr: '/pr <PR_NUMBER>',
    build: `/build ${branch} ${packages.join(' ')}${arch ? ` ${arch}` : ''}`,
  }

  return {
    branch,
    commitMessage,
    commitBody,
    prTitle,
    prBody,
    builditCommands,
    warnings,
    checklist,
  }
}

function normalizePackages(value) {
  let packages
  if (Array.isArray(value)) packages = value
  else if (typeof value === 'string') packages = value.split(/[\s,]+/)
  else packages = []
  const normalized = packages
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  if (normalized.length === 0) {
    throw new Error('aosc_topic_plan: packages must be a non-empty array of package names')
  }
  return normalized
}

function normalizeLabels(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
  }
  return []
}

function normalizeDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim()
  return new Date().toISOString().slice(0, 10)
}

function topicBranch(kind, { base, version, purpose, date }) {
  switch (kind) {
    case 'update':
    case 'security':
      return version ? `${base}-${version}` : `${base}-update`
    case 'new':
      return `${base}-new`
    case 'change':
      return version ? `${base}-${version}-${purpose ?? 'change'}` : `${base}-${purpose ?? 'change'}`
    case 'drop':
      return `${base}-drop`
    case 'rebuild':
      return `planned-rebuild-${date.replace(/-/g, '')}`
    default:
      throw new Error(`aosc_topic_plan: unsupported kind ${kind}`)
  }
}

function topicSubject(kind, { base, version, purpose }) {
  switch (kind) {
    case 'update':
      return version ? `${base}: update to ${version}` : `${base}: update`
    case 'security':
      return version ? `${base}: security update to ${version}` : `${base}: security update`
    case 'new':
      return version ? `${base}: new, ${version}` : `${base}: new`
    case 'change':
      return `${base}: ${purpose ?? 'change'}`
    case 'drop':
      return `${base}: drop, orphaned`
    case 'rebuild':
      return `rebuild ${base}`
    default:
      throw new Error(`aosc_topic_plan: unsupported kind ${kind}`)
  }
}

function topicCommitBody(kind, { base, packages, version, purpose, branch }) {
  const lines = []
  if (kind === 'update') {
    lines.push(`- Update ${base}${version ? ` to ${version}` : ''}.`)
  } else if (kind === 'security') {
    lines.push(`- Security update${version ? ` to ${version}` : ''} for ${base}.`)
  } else if (kind === 'new') {
    lines.push(`- Add ${base}${version ? ` ${version}` : ''} to the ABBS tree.`)
  } else if (kind === 'change') {
    lines.push(`- ${purpose ?? 'Change'} for ${base}.`)
  } else if (kind === 'drop') {
    lines.push(`- Drop ${base}, which is now orphaned.`)
  } else {
    lines.push(`- Rebuild ${base} against the current stable tree.`)
  }
  if (packages.length > 1) {
    lines.push(`- Packages in build order: ${packages.join(', ')}.`)
  }
  lines.push(`- Topic branch: ${branch}.`)
  return lines.join('\n')
}

function topicPrBody(kind, { base, packages, version, purpose, branch, checklist }) {
  const count = packages.length
  const summary = (() => {
    if (kind === 'update') return `This topic updates ${base}${version ? ` to ${version}` : ''} in the AOSC OS ABBS tree.`
    if (kind === 'security') return `This topic contains a security update${version ? ` to ${version}` : ''} for ${base}.`
    if (kind === 'new') return `This topic adds ${base}${version ? ` ${version}` : ''} to the AOSC OS ABBS tree.`
    if (kind === 'change') return `This topic applies the ${purpose ?? 'requested'} change to ${base}.`
    if (kind === 'drop') return `This topic drops ${base}, which is now orphaned.`
    return `This topic rebuilds ${base} against the current stable tree.`
  })()

  const buildOrder = packages
    .map((entry, index) => `${index + 1}. \`${entry}\``)
    .join('\n')
  const installable = packages.map((entry) => `\`${entry}\``).join(', ')
  const checklistLines = checklist.map((entry) => `- [ ] ${entry}`).join('\n')

  return [
    '## Summary',
    '',
    `${summary} The ${count === 1 ? 'package is' : 'packages are'} listed below in build order; build and test each entry in that order.`,
    '',
    '## Build order',
    '',
    buildOrder,
    '',
    '## Test plan',
    '',
    '- [ ] Enable the topic and confirm it resolves: `oma topics`.',
    `- [ ] Install the topic build(s): \`oma install ${installable}\`.`,
    '- [ ] Smoke-test the installed binaries and confirm the reported version.',
    '- [ ] Revert to the stable topic after testing: `oma topics`.',
    '',
    '## Checklist',
    '',
    checklistLines,
    '',
    `Topic branch: \`${branch}\``,
  ].join('\n')
}

function openprCommand({ title, branch, packages, labels, arch }) {
  const segments = [title, branch, packages.join(',')]
  if (labels.length > 0) segments.push(labels.join(','))
  let command = `/openpr ${segments.join(';')}`
  if (arch) {
    // The label segment stays empty (`;;`) when no labels were provided.
    command += `${labels.length > 0 ? '' : ';'};${arch}`
  }
  return command
}

function toText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}
