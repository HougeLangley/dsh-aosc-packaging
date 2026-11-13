/**
 * Produce a copy-paste build and release plan for AOSC OS packages.
 *
 * The plan mirrors the real workflow: Ciel/BuildKit setup, ABBS branch, ordered
 * builds, `.deb` inspection, topic testing, commit/PR through BuildIt!, the
 * mandatory post-merge stable rebuild and the server-side p-vector release.
 */

/**
 * @param {object} input
 * @param {string[]|string} input.packages package names in build order
 * @param {string} [input.instance] Ciel instance (default `main`)
 * @param {string} [input.arch] target architecture, for the BuildIt! build
 * @param {string} [input.topic] topic branch name
 * @param {string} [input.workspace] local directory that holds the ABBS checkout
 */
export function buildPlan(input = {}) {
  const packages = normalizePackages(input.packages)
  const instance = toText(input.instance) ?? 'main'
  const arch = toText(input.arch)
  const workspace = toText(input.workspace)
  const base = packages[0]
  const topic = toText(input.topic) ?? `${base}-update`
  const repo = 'aosc-os-abbs'
  const cloneUrl = 'https://github.com/AOSC-Dev/aosc-os-abbs'

  const prepare = []
  if (workspace) {
    prepare.push(command(`mkdir -p ${workspace}`, 'Create the workspace directory that will hold the ABBS checkout.'))
    prepare.push(command(`cd ${workspace}`, 'Enter the workspace before initialising Ciel and cloning the tree.'))
  }
  prepare.push(command(
    'ciel new',
    `Run the Ciel wizard and create an instance named ${instance} (run as root; answer the target-architecture and maintainer prompts).`,
  ))
  prepare.push(command('ciel update-os', 'Bring the BuildKit environment up to date before the first build.'))

  const checkout = [
    command(`git clone ${cloneUrl}`, 'Clone the AOSC OS main tree (ABBS).'),
    command(`cd ${repo}`, 'Enter the ABBS checkout.'),
    command('git checkout stable', 'Start from the stable branch.'),
    command('git pull --ff-only', 'Sync the local stable branch with upstream.'),
    command(`git checkout -b ${topic}`, `Create the topic branch ${topic}.`),
  ]

  const build = packages.map((pkg) => command(
    `ciel build -i ${instance} ${pkg}`,
    `Build ${pkg} in the ${instance} instance; use a clean BuildKit for each package and confirm "BUILD SUCCESSFUL".`,
  ))

  const inspect = [
    command('ls -lh OUTPUT-stable/debs', 'List the produced .deb files.'),
    command('for f in OUTPUT-stable/debs/*.deb; do dpkg-deb -I "$f"; done', 'Inspect package control metadata (name, version, dependencies).'),
    command('for f in OUTPUT-stable/debs/*.deb; do dpkg-deb -c "$f"; done', 'Inspect package contents and installation paths.'),
  ]

  const installTest = [
    command('oma topics', 'List the available topic builds; enable the topic that contains these packages.'),
    command(`oma install ${packages.join(' ')}`, `Install the topic build(s) ${packages.join(', ')} and run a smoke test.`),
  ]

  const publish = [
    command('git add -A', 'Stage the spec/defines changes.'),
    command('git commit', 'Commit with the message format from the styling manual (editor opens).'),
    command('git rebase stable', 'Rebase the topic branch on the latest stable before submitting.'),
    command(
      `/openpr ${base}: update;${topic};${packages.join(',')}`,
      'Submit the pull request in the BuildIt! chat; adjust the title if this topic is not a plain update (aosc_topic_plan prints the exact string).',
    ),
  ]

  const stableRebuild = [
    command('git checkout stable', 'Switch back to stable after the PR is merged.'),
    command('git pull --ff-only', 'Pull the merged changes.'),
    ...packages.map((pkg) => command(
      `ciel build -i ${instance} ${pkg}`,
      `Rebuild ${pkg} on stable after the merge; this final rebuild is mandatory for the repository.`,
    )),
  ]

  const release = [
    command('p-vector scan', 'Run on the AOSC release server: scan the built packages for QA issues.'),
    command('p-vector release', 'Run on the AOSC release server: release the scanned packages to the repository.'),
    command('p-vector sync', 'Run on the AOSC release server: sync the repository metadata and mirrors.'),
    command('p-vector analyze', 'Run on the AOSC release server: analyse the release result and QA reports.'),
  ]

  const notes = [
    'Ciel requires a Linux host with root privileges; macOS and Windows cannot run the BuildKit builds natively.',
    'Reserve at least 10 GiB of free disk space for the Ciel/BuildKit instance and the package output.',
    'Build every package in its own clean BuildKit instance; do not reuse a dirty instance across packages.',
    'The post-merge rebuild on stable is mandatory: the topic build alone does not update the stable repository.',
    'Run p-vector scan/release/sync/analyze on the AOSC server side, not from the packaging workstation.',
  ]
  if (arch) {
    notes.push(`BuildIt! /build targets ${arch}; pass the same arch to aosc_topic_plan and /openpr.`)
  }

  return {
    prerequisites: [
      { command: 'ciel --version', purpose: 'Confirm Ciel is installed and show its version.', required: true },
      { command: 'oma --version', purpose: 'Confirm oma is installed for topic testing.', required: true },
      { command: 'git --version', purpose: 'Confirm git is available for the ABBS checkout.', required: true },
    ],
    phases: [
      { name: 'Prepare the build environment', commands: prepare },
      { name: 'Check out the ABBS tree and topic branch', commands: checkout },
      { name: 'Build the packages in order', commands: build },
      { name: 'Inspect the built packages', commands: inspect },
      { name: 'Install and test', commands: installTest },
      { name: 'Commit and open the pull request', commands: publish },
      { name: 'Rebuild on stable after merge', commands: stableRebuild },
      { name: 'Release the repository with p-vector', commands: release },
    ],
    notes,
    checklist: [
      `Ciel runs on a Linux host with root privileges and at least 10 GiB free.`,
      `The ${instance} BuildKit instance is up to date (ciel update-os).`,
      `Every package was built in a clean BuildKit and reported BUILD SUCCESSFUL.`,
      `oma topics was enabled and the package was smoke-tested before the PR.`,
      `The topic PR was merged and every package was rebuilt on stable afterwards.`,
      `p-vector scan/release/sync was completed on the server side.`,
    ],
  }
}

function command(cmd, purpose) {
  return { cmd, purpose, optional: false }
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
    throw new Error('aosc_build_plan: packages must be a non-empty array of package names')
  }
  return normalized
}

function toText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}
