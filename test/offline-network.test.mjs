import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSandboxManager } from '../dist/index.js'
import { checkLinuxDependencies } from '../dist/sandbox/linux-sandbox-utils.js'

const offline = {
  network: { offline: true, allowedDomains: [], deniedDomains: ['*'] },
  filesystem: { includeDefaultWritePaths: false, denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
}

// A listening host service distinguishes a blocked namespace from an unused
// port returning ECONNREFUSED without isolation. Unix socket creation in the
// writable workspace catches the loss of mandatory AF_UNIX seccomp filtering.
test('fixed Linux offline mode starts no proxy and isolates TCP and Unix sockets', {
  skip: process.platform !== 'linux',
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'srt-offline-'))
  const tcp = net.createServer()
  tcp.listen(0, '127.0.0.1')
  const manager = createSandboxManager()
  try {
    await once(tcp, 'listening')
    await manager.initialize({ ...offline, filesystem: { ...offline.filesystem, allowWrite: [root] }, socatPath: '/absent/socat' })
    assert.equal(manager.getProxyPort(), undefined)
    assert.equal(manager.getSocksProxyPort(), undefined)
    await assert.rejects(
      manager.wrapWithSandbox('true', '/bin/sh', { network: { allowedDomains: ['example.com'] } }),
      /cannot be overridden/,
    )
    assert.throws(() => manager.updateConfig(offline), /cannot be updated/)
    const scripts = [
      {
        script: `const net=require("node:net"); const s=net.connect(${tcp.address().port},"127.0.0.1"); s.on("connect",()=>process.exit(0)); s.on("error",e=>{console.error("OFFLINE_DENIED:"+e.code);process.exit(7)})`,
        expected: /OFFLINE_DENIED:(ENETUNREACH|EADDRNOTAVAIL|ECONNREFUSED|EPERM)/,
      },
      {
        script: `const net=require("node:net"); const s=net.createServer(); s.on("error",e=>{console.error("OFFLINE_DENIED:"+String(e));process.exit(7)}); s.listen({path:${JSON.stringify(join(root, 'candidate.sock'))}},()=>process.exit(0))`,
        expected: /OFFLINE_DENIED:(.*(EPERM|EACCES|Operation not permitted|Failed to listen at))/i,
      },
    ]
    for (const { script, expected } of scripts) {
      // A host control with the same runtime proves a real connection/socket
      // can succeed. Use another pathname so it cannot cause EADDRINUSE.
      const hostScript = script.replace('candidate.sock', 'host-control.sock')
      const host = spawnSync(process.execPath, ['-e', hostScript], {
        cwd: root, timeout: 5_000,
        env: { PATH: process.env.PATH, HOME: root, TMPDIR: root }, encoding: 'utf8',
      })
      assert.equal(host.status, 0, host.stderr)
      const wrapped = await manager.wrapWithSandbox(`printf allowed > marker; '${process.execPath}' -e '${script}'`, '/bin/sh')
      const result = spawnSync('/bin/sh', ['-c', wrapped], {
        cwd: root, timeout: 10_000,
        env: { PATH: process.env.PATH, HOME: root, TMPDIR: root }, encoding: 'utf8',
      })
      assert.equal(result.status, 7, result.stderr)
      assert.match(result.stderr, expected)
      assert.equal(readFileSync(join(root, 'marker'), 'utf8'), 'allowed')
    }
  } finally {
    manager.cleanupAfterCommand()
    await manager.reset()
    tcp.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('offline mode rejects proxy, non-deny-all, or unverified seccomp configurations', async () => {
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
  assert.match(checkLinuxDependencies({ offline: true, seccompConfig: { argv0: 'unverified' } }).errors.join(' '), /requires an on-disk seccomp/)
})
