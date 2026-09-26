import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSandboxManager } from '../dist/index.js'

for (const includeDefaultWritePaths of [false, true]) {
  test(`default write paths ${includeDefaultWritePaths ? 'remain backward compatible' : 'can be removed'}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'srt-locked-writes-'))
    const workspace = join(root, 'workspace')
    const home = join(root, 'home')
    const logs = join(home, '.npm', '_logs')
    mkdirSync(workspace)
    mkdirSync(logs, { recursive: true })
    const sentinel = join(logs, 'sentinel')
    writeFileSync(sentinel, 'original')
    const previousHome = process.env.HOME
    process.env.HOME = home
    const manager = createSandboxManager()
    let wrapped = false
    try {
      await manager.initialize({
        network: { allowedDomains: [], deniedDomains: ['*'] },
        filesystem: {
          includeDefaultWritePaths,
          denyRead: [], allowRead: [], allowWrite: [workspace], denyWrite: [],
        },
      })
      const allowed = manager.getFsWriteConfig().allowOnly
      assert.ok(allowed.includes(workspace))
      if (includeDefaultWritePaths) assert.ok(allowed.includes(logs))
      else assert.deepEqual(allowed, [workspace])
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
        env: { PATH: process.env.PATH, HOME: home, TMPDIR: workspace },
        encoding: 'utf8',
      })
      assert.equal(result.status === 0, includeDefaultWritePaths, result.stderr)
      assert.equal(readFileSync(sentinel, 'utf8'), includeDefaultWritePaths ? 'changed' : 'original')
    } finally {
      if (wrapped) manager.cleanupAfterCommand()
      await manager.reset()
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      rmSync(root, { recursive: true, force: true })
    }
  })
}
