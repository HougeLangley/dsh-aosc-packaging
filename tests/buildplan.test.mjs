import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPlan } from '../lib/buildplan.js'

const EXPECTED_PHASES = [
  'Prepare the build environment',
  'Check out the ABBS tree and topic branch',
  'Build the packages in order',
  'Inspect the built packages',
  'Install and test',
  'Commit and open the pull request',
  'Rebuild on stable after merge',
  'Release the repository with p-vector',
]

test('phases are ordered and every required command is present', () => {
  const plan = buildPlan({ packages: ['nano', 'vim'], instance: 'main', topic: 'nano-7.2' })

  assert.deepEqual(plan.phases.map((phase) => phase.name), EXPECTED_PHASES)
  const commands = plan.phases.flatMap((phase) => phase.commands.map((command) => command.cmd))
  assert.ok(commands.includes('git clone https://github.com/AOSC-Dev/aosc-os-abbs'))
  assert.ok(commands.includes('git checkout -b nano-7.2'))
  assert.ok(commands.includes('ciel build -i main nano'))
  assert.ok(commands.includes('ciel build -i main vim'))
  assert.ok(commands.includes('oma topics'))
  assert.ok(commands.includes('git rebase stable'))
  assert.ok(commands.includes('ls -lh OUTPUT-stable/debs'))
  assert.equal(plan.prerequisites[0].command, 'ciel --version')
  assert.equal(plan.prerequisites[0].required, true)
})

test('packages are built in the supplied order', () => {
  const plan = buildPlan({ packages: ['alpha', 'beta', 'gamma'] })
  const buildPhase = plan.phases.find((phase) => phase.name === 'Build the packages in order')
  assert.deepEqual(
    buildPhase.commands.map((command) => command.cmd),
    ['ciel build -i main alpha', 'ciel build -i main beta', 'ciel build -i main gamma'],
  )
})

test('notes cover Linux/root, disk, clean BuildKit, stable rebuild and p-vector', () => {
  const plan = buildPlan({ packages: ['nano'], arch: 'amd64' })
  const notes = plan.notes.join('\n')

  assert.match(notes, /Linux/)
  assert.match(notes, /root/)
  assert.match(notes, /10 GiB/)
  assert.match(notes, /clean BuildKit/i)
  assert.match(notes, /mandatory/i)
  assert.match(notes, /server side/i)
  assert.match(notes, /amd64/)
})

test('topic defaults to the first package and workspace adds setup commands', () => {
  const plan = buildPlan({ packages: ['nano'], workspace: 'packager-work' })
  const commands = plan.phases.flatMap((phase) => phase.commands.map((command) => command.cmd))

  assert.ok(commands.includes('git checkout -b nano-update'))
  assert.ok(commands.includes('mkdir -p packager-work'))
  assert.ok(commands.includes('cd packager-work'))
})

test('stable rebuild repeats every package in the final phase', () => {
  const plan = buildPlan({ packages: ['nano', 'vim'], instance: 'build' })
  const stable = plan.phases.find((phase) => phase.name === 'Rebuild on stable after merge')
  assert.deepEqual(
    stable.commands.filter((command) => command.cmd.startsWith('ciel build')).map((command) => command.cmd),
    ['ciel build -i build nano', 'ciel build -i build vim'],
  )
})

test('invalid packages are rejected', () => {
  assert.throws(() => buildPlan({ packages: [] }), /non-empty/)
  assert.throws(() => buildPlan({ packages: '   ' }), /non-empty/)
})
