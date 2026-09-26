import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSandboxManager } from '../dist/index.js'

const offline = {
  network: { offline: true, allowedDomains: [], deniedDomains: ['*'] },
  filesystem: { includeDefaultWritePaths: false, denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
}

test('fixed Linux offline mode starts no host proxy or bridge and isolates loopback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'srt-offline-'))
  const manager = createSandboxManager()
  try {
    await manager.initialize({ ...offline, filesystem: { ...offline.filesystem, allowWrite: [root] } })
    assert.equal(manager.getProxyPort(), undefined)
    assert.equal(manager.getSocksProxyPort(), undefined)
    await assert.rejects(
      manager.wrapWithSandbox('true', '/bin/sh', { network: { allowedDomains: ['example.com'] } }),
      /cannot be overridden/,
    )
    assert.throws(() => manager.updateConfig(offline), /cannot be updated/)
    const wrapped = await manager.wrapWithSandbox(
      "printf allowed > marker; python3 -c 'import socket; socket.create_connection((\"127.0.0.1\", 12345), 0.25)'",
      '/bin/sh',
    )
    const result = spawnSync('/bin/sh', ['-c', wrapped], {
      cwd: root, timeout: 10_000,
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root }, encoding: 'utf8',
    })
    assert.equal(result.status, 1, result.stderr)
    // The authorized write still completed before the denied connection.
    assert.equal((await import('node:fs')).readFileSync(join(root, 'marker'), 'utf8'), 'allowed')
  } finally {
    manager.cleanupAfterCommand()
    await manager.reset()
    rmSync(root, { recursive: true, force: true })
  }
})

test('offline mode rejects any proxy or non-deny-all configuration', async () => {
  const cases = [
    { allowedDomains: ['example.com'] },
    { deniedDomains: [] },
    { httpProxyPort: 3128 },
    { allowAllUnixSockets: true },
    { allowLocalBinding: true },
  ]
  for (const override of cases) {
    const manager = createSandboxManager()
    await assert.rejects(manager.initialize({ ...offline, network: { ...offline.network, ...override } }), /Offline mode requires Linux/)
    assert.equal(manager.isSandboxingEnabled(), false)
  }
})
