import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSandboxManager } from '../dist/index.js'

for (const includeDefaultWritePaths of [false, true]) {
  test(`default write paths ${includeDefaultWritePaths ? 'remain backward compatible' : 'can be removed'}`, async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'srt-locked-writes-'))
    const manager = createSandboxManager()
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
      if (includeDefaultWritePaths) assert.ok(allowed.length > 1)
      else assert.deepEqual(allowed, [workspace])
      await assert.rejects(
        manager.wrapWithSandbox('true', undefined, {
          filesystem: { includeDefaultWritePaths: !includeDefaultWritePaths },
        }),
        /cannot change per call/,
      )
    } finally {
      await manager.reset()
      rmSync(workspace, { recursive: true, force: true })
    }
  })
}
