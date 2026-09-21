import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { runtimeConfig } from '../server/runtime.js'
import { applicationUrl, createWechatClient, parsePointQr, safeReturnTo } from '../server/wechat.js'
import { saveSession } from '../server/session.js'
import { createScanner } from '../web/src/wechat-scan.js'

const origin = 'https://activity.example.test'
const points = [{ key: 'p01', name: '葫芦娃' }, { key: 'p02', name: '卢氏大宗祠' }]
const testSecret = 'local-test-only-not-a-production-secret'
const errorCode = (code) => (error) => error.code === code

// These tests simulate WeChat network responses / native SDK callbacks, not actual WeChat devices.
test('runtime: explicit mock mode only; production cannot fall back to a demonstration', () => {
  assert.equal(runtimeConfig({ NODE_ENV: 'development' }).mockEnabled, false)
  assert.equal(runtimeConfig({ NODE_ENV: 'test', DEV_MOCK_ENABLED: 'true', SESSION_SECRET: testSecret }).mockEnabled, true)
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production', DEV_MOCK_ENABLED: 'true' }), /allowed only/)
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production', DEV_MOCK_ENABLED: 'TRUE' }), /true or false/)
  assert.throws(() => runtimeConfig({ NODE_ENV: 'staging', DEV_MOCK_ENABLED: 'true' }), /allowed only/)
  assert.throws(() => runtimeConfig({ NODE_ENV: 'development', DEV_MOCK_ENABLED: 'true' }), /SESSION_SECRET/)
  assert.throws(() => runtimeConfig({ SESSION_SECRET: 'short' }), /32 characters/)
  const production = { NODE_ENV: 'production', PUBLIC_ORIGIN: origin, SESSION_SECRET: testSecret, WECHAT_APP_ID: 'test-app', WECHAT_APP_SECRET: 'test-secret', UPLOAD_DIR: '/test-only' }
  assert.equal(runtimeConfig(production).secureCookie, true)
  assert.throws(() => runtimeConfig({ ...production, PUBLIC_ORIGIN: 'http://activity.example.test' }), /HTTPS/)
})

test('QR parser: exact origin and literal /q/key; no credentials, disguised host, /r, dot paths or extra components', () => {
  assert.deepEqual(parsePointQr(`${origin}/q/p01`, origin, points), points[0])
  const invalid = [undefined, 123, '/q/p01', `${origin}.evil.test/q/p01`, 'https://evil.test/?url=' + origin + '/q/p01',
    'https://activity.example.test@evil.test/q/p01', 'https://user@activity.example.test/q/p01',
    `${origin}:444/q/p01`, 'http://activity.example.test/q/p01', `${origin}/q/p99`, `${origin}/r/123`,
    `${origin}/q/p01/`, `${origin}/q/p01?x=1`, `${origin}/q/p01#x`, `${origin}/q/%70%30%31`,
    `${origin}/other/../q/p01`, `${origin}/q/./p01`, `${origin}//q/p01`, `${origin}\\q\\p01`, ` ${origin}/q/p01`,
    'javascript:alert(1)', 'data:text/plain,/q/p01', `${origin}/q/P01`]
  for (const value of invalid) assert.throws(() => parsePointQr(value, origin, points), errorCode('INVALID_QR'), String(value))
})

test('signing URLs stay in the application; callback return URLs cannot escape or loop into auth/API', () => {
  assert.equal(applicationUrl(`${origin}/?a=1#point/p01`, origin).origin, origin)
  assert.equal(safeReturnTo('/#point/p01', origin), '/#point/p01')
  assert.equal(safeReturnTo(undefined, origin), '/')
  for (const path of ['//evil.test', '/\\evil.test', 'https://evil.test', '/%2f%2fevil.test', '/auth/wechat', '/auth/callback', '/api/me', '/x/../auth/wechat']) {
    assert.throws(() => safeReturnTo(path, origin))
  }
  assert.throws(() => applicationUrl(`${origin}.evil.test/`, origin), errorCode('INVALID_URL'))
})

test('simulated WeChat: snsapi_base, fixed callback, server code exchange and original-URL SHA1 signing', async () => {
  let time = 1700000000000
  const counts = { token: 0, ticket: 0, oauth: 0 }
  const mockFetch = async (value, options) => {
    const url = new URL(value)
    assert.equal(url.origin, 'https://api.weixin.qq.com')
    assert.equal(options.redirect, 'error')
    if (url.pathname === '/cgi-bin/stable_token') {
      counts.token++
      assert.deepEqual(JSON.parse(options.body), { grant_type: 'client_credential', appid: 'simulated-app', secret: 'simulated-secret', force_refresh: false })
      await delay(2)
      return { ok: true, json: async () => ({ access_token: 'simulated-token', expires_in: 7200 }) }
    }
    if (url.pathname === '/cgi-bin/ticket/getticket') {
      counts.ticket++
      assert.equal(url.searchParams.get('access_token'), 'simulated-token')
      return { ok: true, json: async () => ({ errcode: 0, ticket: 'simulated-ticket', expires_in: 7200 }) }
    }
    assert.equal(url.pathname, '/sns/oauth2/access_token')
    counts.oauth++
    assert.equal(url.searchParams.get('code'), 'simulated-code')
    return { ok: true, json: async () => ({ openid: 'simulated-openid', access_token: 'never-return-this-token' }) }
  }
  const client = createWechatClient({ appId: 'simulated-app', appSecret: 'simulated-secret', publicOrigin: origin, fetchImpl: mockFetch, now: () => time })
  const authorization = new URL(client.authorizationUrl('test-state'))
  assert.equal(authorization.searchParams.get('scope'), 'snsapi_base')
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/auth/callback`)
  assert.equal(authorization.searchParams.get('state'), 'test-state')
  assert.equal(await client.exchangeCode('simulated-code'), 'simulated-openid')
  const page = `${origin}/?b=two%20words&a=1#point/p02`
  const configs = await Promise.all(Array.from({ length: 4 }, () => client.jsConfig(page)))
  assert.deepEqual(counts, { token: 1, ticket: 1, oauth: 1 })
  for (const config of configs) {
    const expected = createHash('sha1').update(`jsapi_ticket=simulated-ticket&noncestr=${config.nonceStr}&timestamp=${config.timestamp}&url=${page.split('#')[0]}`).digest('hex')
    assert.equal(config.signature, expected)
    assert.deepEqual(Object.keys(config).sort(), ['appId', 'jsApiList', 'nonceStr', 'signature', 'timestamp'])
    assert.doesNotMatch(JSON.stringify(config), /simulated-secret|simulated-ticket|simulated-token/)
  }
  time += 7200 * 1000
  await client.jsConfig(page)
  assert.deepEqual(counts, { token: 2, ticket: 2, oauth: 1 })
})

test('simulated WeChat failures are readable and do not leak provider data or cache a failed response', async () => {
  let fail = true
  const client = createWechatClient({ appId: 'test', appSecret: 'private-test', publicOrigin: origin, fetchImpl: async () => {
    if (fail) return { ok: true, json: async () => ({ errcode: 40029, errmsg: 'private upstream detail' }) }
    return { ok: true, json: async () => ({ openid: 'valid-openid' }) }
  } })
  await assert.rejects(client.exchangeCode('invalid-code'), (error) => error.code === 'WECHAT_UNAVAILABLE' && !/private/.test(error.message))
  fail = false
  assert.equal(await client.exchangeCode('valid-code'), 'valid-openid')
  for (const response of [{ ok: false }, { ok: true, json: async () => { throw new Error('private JSON failure') } }, { ok: true, json: async () => ({ openid: '' }) }]) {
    const broken = createWechatClient({ publicOrigin: origin, fetchImpl: async () => response })
    await assert.rejects(broken.exchangeCode('test'), errorCode('WECHAT_UNAVAILABLE'))
  }
})

test('session save awaits its callback and a failed save cannot be retried as a successful login by a response hook', async () => {
  let saved = false
  let callback
  const pending = saveSession({ session: { save: (done) => { callback = done } } }).then(() => { saved = true })
  await delay(1)
  assert.equal(saved, false)
  callback()
  await pending
  assert.equal(saved, true)
  let destroyed = false
  const request = { session: { userId: '1', save: (done) => done(new Error('simulated storage failure')), destroy: (done) => { destroyed = true; done() } } }
  await assert.rejects(saveSession(request), errorCode('SAVE_FAILED'))
  assert.equal(destroyed, true)
  assert.equal(request.session, null)
})

function scannerHarness(options = {}) {
  const state = { phase: 'idle', message: '' }
  const callbacks = {}
  const seen = []
  const sdk = {
    config: (value) => { callbacks.config = value },
    ready: (done) => { callbacks.ready = done },
    error: (done) => { callbacks.error = done },
    scanQRCode: (value) => { callbacks.scan = value }
  }
  const scanner = createScanner({ state, loadSdk: async () => sdk, getConfig: async () => ({ appId: 'simulated', jsApiList: ['scanQRCode'] }),
    submit: async (result) => ({ point: { key: result }, alreadyCompleted: false }), onPoint: (value) => seen.push(value),
    initTimeout: 80, scanTimeout: 80, resumeDelay: 3, ...options })
  async function ready() {
    const pending = scanner.initialize()
    await delay(1)
    callbacks.ready()
    assert.equal(await pending, true)
  }
  return { scanner, state, callbacks, seen, ready }
}

test('simulated SDK: only wx.ready enables scanning; cancellation, denied permission and success all recover', async () => {
  const h = scannerHarness()
  assert.equal(await h.scanner.scan(), false)
  const initializing = h.scanner.initialize()
  await delay(1)
  assert.equal(h.state.phase, 'initializing')
  assert.equal(await h.scanner.scan(), false)
  h.callbacks.ready()
  await initializing
  for (const outcome of ['cancel', 'fail']) {
    const result = h.scanner.scan()
    assert.equal(h.callbacks.scan.needResult, 1)
    assert.deepEqual(h.callbacks.scan.scanType, ['qrCode'])
    h.callbacks.scan[outcome]()
    assert.equal(await result, false)
    assert.equal(h.state.phase, 'ready')
  }
  const success = h.scanner.scan()
  await h.callbacks.scan.success({ resultStr: 'p01' })
  assert.equal(await success, true)
  assert.equal(h.seen[0].point.key, 'p01')
  assert.equal(h.state.phase, 'ready')
  h.scanner.dispose()
})

test('simulated SDK: initialization failure / timeout can be retried, and late callbacks do not revive a failed attempt', async () => {
  const h = scannerHarness({ initTimeout: 8 })
  const first = h.scanner.initialize()
  await delay(1)
  const staleReady = h.callbacks.ready
  h.callbacks.error({ errMsg: 'config:fail' })
  assert.equal(await first, false)
  assert.equal(h.state.phase, 'error')
  staleReady()
  assert.equal(h.state.phase, 'error')
  assert.equal(await h.scanner.initialize(), false)
  assert.equal(h.state.phase, 'error')
  await h.ready()
  assert.equal(h.state.phase, 'ready')
  h.scanner.dispose()
})

test('simulated SDK: incorrect QR and session failure do not mark a point and do not leave the button disabled', async () => {
  const failures = []
  const h = scannerHarness({ submit: async () => { throw Object.assign(new Error('请重新进入活动'), { code: 'NEED_LOGIN' }) }, onFailure: (error) => failures.push(error.code) })
  await h.ready()
  const pending = h.scanner.scan()
  await h.callbacks.scan.success({ resultStr: `${origin}/r/not-a-point` })
  assert.equal(await pending, false)
  assert.equal(h.state.phase, 'ready')
  assert.equal(h.seen.length, 0)
  assert.deepEqual(failures, ['NEED_LOGIN'])
  h.scanner.dispose()
})

test('simulated SDK: returning to page without native callbacks permits another scan; stale success is ignored', async () => {
  const h = scannerHarness()
  await h.ready()
  const first = h.scanner.scan()
  const stale = h.callbacks.scan
  h.scanner.resume()
  assert.equal(await first, false)
  assert.equal(h.state.phase, 'ready')
  const second = h.scanner.scan()
  await stale.success({ resultStr: 'stale' })
  assert.equal(h.seen.length, 0)
  await h.callbacks.scan.success({ resultStr: 'p02' })
  assert.equal(await second, true)
  assert.equal(h.seen[0].point.key, 'p02')
  h.scanner.dispose()
})
