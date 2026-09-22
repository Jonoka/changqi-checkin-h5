import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { runtimeConfig } from '../server/runtime.js'
import { createApp } from '../server/app.js'
import { loadActivityConfig } from '../server/config.js'
import { findClaimUser, publicClaimState } from '../server/claims.js'
import { claimWithRecovery } from '../web/src/claim-action.js'

const unclaimed = { userLabel: 'CQ000001', completedCount: 5, totalCount: 5, allCompleted: true, claimedAt: null }
const claimed = { ...unclaimed, claimedAt: '2026-09-22T12:00:00+08:00' }

test('A3: bearer projection contains only the five public fields, invalid codes never query a database', async () => {
  assert.deepEqual(publicClaimState({ ...unclaimed, claimUrl: 'private', completedKeys: ['p01'], openid: 'private', photo_path: 'private' }), unclaimed)
  for (const code of ['', 'a'.repeat(31), 'A'.repeat(32), 'g'.repeat(32), '../p01', ['a'.repeat(32)]]) {
    await assert.rejects(findClaimUser(null, code), (error) => error.code === 'INVALID_CLAIM_CODE')
  }
})

test('A3: fixed statistics credential is optional but partial or weak configuration is rejected', () => {
  assert.equal(runtimeConfig({}).statsUser, '')
  assert.throws(() => runtimeConfig({ STATS_USER: 'report' }), /both/)
  assert.throws(() => runtimeConfig({ STATS_USER: 'report', STATS_PASSWORD: 'short' }), /at least 16/)
  assert.throws(() => runtimeConfig({ STATS_USER: 'bad:user', STATS_PASSWORD: 'x'.repeat(32) }), /simple username/)
})

test('A3: statistics are fail-closed without a credential; Basic Auth never leaks submitted credentials', async () => {
  for (const enabled of [false, true]) {
    const runtime = runtimeConfig(enabled ? { STATS_USER: 'report', STATS_PASSWORD: 'test-only-password-123456' } : {})
    const server = http.createServer(createApp({ activityConfig: loadActivityConfig(), runtime }))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    try {
      const response = await fetch(`${origin}/stats`)
      assert.equal(response.status, enabled ? 401 : 503)
      assert.doesNotMatch(await response.text(), /data-stats-count/)
      const denied = await fetch(`${origin}/stats`, { headers: { authorization: `Basic ${Buffer.from('report:DO-NOT-ECHO').toString('base64')}` } })
      assert.doesNotMatch(await denied.text(), /DO-NOT-ECHO/)
      if (enabled) {
        const failure = await fetch(`${origin}/stats`, { headers: { authorization: `Basic ${Buffer.from('report:test-only-password-123456').toString('base64')}` } })
        assert.equal(failure.status, 503)
        const text = await failure.text()
        assert.match(text, /暂时无法读取/); assert.doesNotMatch(text, /data-stats-count/)
      }
      const me = await fetch(`${origin}/api/me/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      assert.equal(me.status, 401); assert.equal((await me.json()).error.code, 'NEED_LOGIN')
      assert.equal((await fetch(`${origin}/api/stats`)).status, 404)
    } finally { await new Promise((resolve) => server.close(resolve)) }
  }
})

test('A3: QR renderer uses the exact claim link, black/white PNG and a four-module quiet zone', async () => {
  const link = `https://activity.example.test/r/${'a'.repeat(32)}`
  const symbol = QRCode.create(link, { errorCorrectionLevel: 'M' })
  const output = await QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 4, scale: 4 })
  assert.match(output, /^data:image\/png;base64,/)
  const image = sharp(Buffer.from(output.split(',')[1], 'base64'))
  const metadata = await image.metadata()
  assert.equal(metadata.width, (symbol.modules.size + 8) * 4)
  assert.equal(metadata.height, metadata.width)
  const corner = await image.extract({ left: 0, top: 0, width: 16, height: 16 }).removeAlpha().raw().toBuffer()
  assert.ok(corner.every((byte) => byte === 255))
  const encoded = symbol.segments.map((segment) => typeof segment.data === 'string' ? segment.data : Buffer.from(segment.data).toString()).join('')
  assert.equal(encoded, link)
})

test('A3: a lost successful response queries state and never submits twice', async () => {
  let writes = 0, reads = 0
  const result = await claimWithRecovery({ submit: async () => { writes++; throw new Error('SIMULATED response loss') }, readState: async () => { reads++; return claimed } })
  assert.deepEqual(result, { state: claimed, recovered: true })
  assert.equal(writes, 1); assert.equal(reads, 1)
  assert.equal((await claimWithRecovery({ submit: async () => claimed, readState: async () => { throw new Error('must not read') } })).recovered, false)
})

test('A3: failed/unknown writes cannot report success; authentication expiry is preserved', async () => {
  await assert.rejects(claimWithRecovery({ submit: async () => { throw new Error('failed') }, readState: async () => unclaimed }), (error) => error.currentState === unclaimed)
  await assert.rejects(claimWithRecovery({ submit: async () => unclaimed, readState: async () => { throw new Error('offline') } }), (error) => error.code === 'VERIFY_REQUIRED')
  await assert.rejects(claimWithRecovery({ submit: async () => { throw new Error('offline') }, readState: async () => { throw Object.assign(new Error('expired'), { code: 'NEED_LOGIN' }) } }), (error) => error.code === 'NEED_LOGIN')
})
