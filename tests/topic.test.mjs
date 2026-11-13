import assert from 'node:assert/strict'
import test from 'node:test'

import { planTopic } from '../lib/topic.js'

test('update topics produce the canonical branch, commit and BuildIt! commands', () => {
  const plan = planTopic({
    packages: ['nano'],
    kind: 'update',
    version: '7.2',
    date: '2026-11-13',
    labels: ['enhancement'],
    arch: 'amd64',
  })

  assert.equal(plan.branch, 'nano-7.2')
  assert.equal(plan.commitMessage, 'nano: update to 7.2')
  assert.equal(plan.prTitle, 'nano: update to 7.2')
  assert.equal(plan.builditCommands.openpr, '/openpr nano: update to 7.2;nano-7.2;nano;enhancement;amd64')
  assert.equal(plan.builditCommands.pr, '/pr <PR_NUMBER>')
  assert.equal(plan.builditCommands.build, '/build nano-7.2 nano amd64')
  assert.deepEqual(plan.warnings, [])
  assert.equal(plan.checklist.length >= 4, true)
  assert.match(plan.commitBody, /Update nano to 7\.2/)
})

test('openpr keeps an empty label segment when arch is set and labels are empty', () => {
  const plan = planTopic({ packages: ['nano'], kind: 'update', version: '7.2', arch: 'amd64' })
  assert.equal(plan.builditCommands.openpr, '/openpr nano: update to 7.2;nano-7.2;nano;;amd64')
})

test('security, new, drop and rebuild subjects follow the manual', () => {
  const security = planTopic({ packages: ['nano'], kind: 'security', version: '7.2' })
  assert.equal(security.branch, 'nano-7.2')
  assert.equal(security.commitMessage, 'nano: security update to 7.2')

  const fresh = planTopic({ packages: ['nano'], kind: 'new', version: '7.2' })
  assert.equal(fresh.branch, 'nano-new')
  assert.equal(fresh.commitMessage, 'nano: new, 7.2')

  const drop = planTopic({ packages: ['nano'], kind: 'drop' })
  assert.equal(drop.branch, 'nano-drop')
  assert.equal(drop.commitMessage, 'nano: drop, orphaned')

  const rebuild = planTopic({ packages: ['nano'], kind: 'rebuild', date: '2026-11-13' })
  assert.equal(rebuild.branch, 'planned-rebuild-20261113')
  assert.match(rebuild.commitMessage, /^rebuild /)
})

test('change topics use the purpose and warn when it is missing', () => {
  const withPurpose = planTopic({
    packages: ['nano'],
    kind: 'change',
    version: '7.2',
    purpose: 'build-fix',
  })
  assert.equal(withPurpose.branch, 'nano-7.2-build-fix')
  assert.equal(withPurpose.commitMessage, 'nano: build-fix')

  const withoutPurpose = planTopic({ packages: ['nano'], kind: 'change' })
  assert.equal(withoutPurpose.branch, 'nano-change')
  assert.ok(withoutPurpose.warnings.some((warning) => /purpose/.test(warning)))
})

test('multi-package topics warn without canonicalPkg and use it when provided', () => {
  const fallback = planTopic({ packages: ['alpha', 'beta'], kind: 'update', version: '1.0' })
  assert.equal(fallback.branch, 'alpha-1.0')
  assert.equal(fallback.commitMessage, 'alpha: update to 1.0')
  assert.ok(fallback.warnings.some((warning) => /canonicalPkg/.test(warning)))

  const canonical = planTopic({
    packages: ['alpha', 'beta'],
    kind: 'update',
    version: '1.0',
    canonicalPkg: 'bundle',
  })
  assert.equal(canonical.branch, 'bundle-1.0')
  assert.equal(canonical.commitMessage, 'bundle: update to 1.0')
  assert.deepEqual(canonical.warnings, [])
})

test('PR body contains summary, build order, test plan and checklist', () => {
  const plan = planTopic({ packages: ['alpha', 'beta'], kind: 'update', version: '2.0', canonicalPkg: 'bundle' })

  for (const heading of ['## Summary', '## Build order', '## Test plan', '## Checklist']) {
    assert.match(plan.prBody, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(plan.prBody, /1\. `alpha`\n2\. `beta`/)
  assert.match(plan.prBody, /oma topics/)
  assert.match(plan.prBody, /clean BuildKit/i)
  assert.match(plan.prBody, /stable/i)
})

test('missing versions warn for new/update/security topics', () => {
  for (const kind of ['new', 'update', 'security']) {
    const plan = planTopic({ packages: ['nano'], kind })
    assert.ok(plan.warnings.some((warning) => /version/.test(warning)), `${kind} should warn`)
  }
})

test('an explicit summary overrides the generated subject', () => {
  const plan = planTopic({
    packages: ['nano'],
    kind: 'update',
    version: '7.2',
    summary: 'nano: update to 7.2 and refresh patches',
  })
  assert.equal(plan.commitMessage, 'nano: update to 7.2 and refresh patches')
  assert.equal(plan.prTitle, plan.commitMessage)
})

test('an invalid kind is rejected', () => {
  assert.throws(() => planTopic({ packages: ['nano'], kind: 'nonsense' }), /not supported/)
  assert.throws(() => planTopic({ packages: [], kind: 'update' }), /non-empty/)
})
