import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const helper = fileURLToPath(new URL('./default-write-paths-helper.mjs', import.meta.url))
for (const includeDefaultWritePaths of [false, true]) {
  test(`default write paths ${includeDefaultWritePaths ? 'remain backward compatible' : 'can be removed'}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'srt-locked-writes-'))
    const workspace = join(root, 'workspace')
    const home = join(root, 'home')
    const logs = join(home, '.npm', '_logs')
    mkdirSync(workspace)
    mkdirSync(logs, { recursive: true })
    const sentinel = join(logs, 'sentinel')
    writeFileSync(sentinel, 'original')
    try {
      // os.homedir() can be cached by the runtime. Use a fresh process with a
      // synthetic HOME from startup, without touching the invoking user's HOME.
      const result = spawnSync(process.execPath, [helper, root, String(includeDefaultWritePaths)], {
        cwd: workspace, timeout: 15_000,
        env: { PATH: process.env.PATH, HOME: home, TMPDIR: workspace }, encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(readFileSync(sentinel, 'utf8'), includeDefaultWritePaths ? 'changed' : 'original')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
