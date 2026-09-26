import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createSandboxManager } from '../dist/index.js'

const [root, enabled] = process.argv.slice(2)
const includeDefaultWritePaths = enabled === 'true'
const workspace = join(root, 'workspace')
const home = join(root, 'home')
const logs = join(home, '.npm', '_logs')
const sentinel = join(logs, 'sentinel')
const manager = createSandboxManager()
let wrapped = false
try {
  const config = {
    network: { allowedDomains: [], deniedDomains: ['*'] },
    filesystem: {
      includeDefaultWritePaths,
      denyRead: [], allowRead: [], allowWrite: [workspace], denyWrite: [],
    },
  }
  await manager.initialize(config)
  const allowed = manager.getFsWriteConfig().allowOnly
  assert.ok(allowed.includes(workspace))
  if (includeDefaultWritePaths) assert.ok(allowed.includes(logs))
  else assert.deepEqual(allowed, [workspace])
  // The caller and getConfig() must not be able to mutate the monitor's
  // initialization-time write policy behind updateConfig's guard.
  config.filesystem.includeDefaultWritePaths = !includeDefaultWritePaths
  config.filesystem.allowWrite.push(join(root, 'outside-grant'))
  assert.deepEqual(manager.getFsWriteConfig().allowOnly, allowed)
  assert.throws(() => manager.updateConfig(config), /requires reset and initialize/)
  config.filesystem.includeDefaultWritePaths = includeDefaultWritePaths
  manager.getConfig().filesystem.includeDefaultWritePaths = !includeDefaultWritePaths
  assert.deepEqual(manager.getFsWriteConfig().allowOnly, allowed)
  assert.throws(
    () => manager.updateConfig({
      ...config,
      filesystem: { ...config.filesystem, includeDefaultWritePaths: !includeDefaultWritePaths },
    }),
    /requires reset and initialize/,
  )
  await assert.rejects(
    manager.wrapWithSandbox('true', undefined, {
      filesystem: { includeDefaultWritePaths: !includeDefaultWritePaths },
    }),
    /cannot change per call/,
  )
  const shellCommand = await manager.wrapWithSandbox(`printf changed > '${sentinel}'`, '/bin/sh')
  wrapped = true
  const result = spawnSync('/bin/sh', ['-c', shellCommand], {
    cwd: workspace, timeout: 10_000,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: workspace }, encoding: 'utf8',
  })
  assert.equal(result.status === 0, includeDefaultWritePaths, result.stderr)
} finally {
  if (wrapped) manager.cleanupAfterCommand()
  await manager.reset()
}
