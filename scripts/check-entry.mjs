import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { findOrCreateUser } from '../server/identity.js'
import { uploadFile } from './check-a2-mysql.mjs'

// Focused extensions of the existing isolated MySQL + Chrome harness, not another test platform.
// Only the provider code exchange/SDK is simulated; sessions, SQL, HTTP and photo writes are real.
const wechatHeaders = { 'user-agent': 'MicroMessenger/8.0 SIMULATED entry regression' }
export async function checkEntryMysql({ pool, activity, baseUrl, browser, oauth, samplePath, store, ok }) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname))
  const bytes = await fs.readFile(samplePath)
  const progress = async client => (await client.request('/api/me')).payload.data
  const begin = async (client, key = 'p03') => {
    const response = await client.request(`/q/${key}`, { headers: wechatHeaders })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(response.headers.get('vary'), /User-Agent/i)
    const authorization = new URL(response.headers.get('location'))
    assert.equal(authorization.searchParams.get('scope'), 'snsapi_base')
    assert.equal(authorization.searchParams.get('redirect_uri'), `${baseUrl}/auth/callback`)
    assert.match(authorization.searchParams.get('state'), /^[A-Za-z0-9]{1,128}$/)
    return authorization.searchParams.get('state')
  }
  const callback = (client, state, code) => client.request(`/auth/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`, { headers: wechatHeaders })
  const enter = async (client, code, key = 'p03') => {
    const previous = client.cookie
    const state = await begin(client, key)
    assert.notEqual(client.cookie, previous, 'direct entry regenerates even an authenticated old session')
    const pendingCookie = client.cookie
    const result = await callback(client, state, code)
    assert.equal(result.status, 302)
    assert.equal(result.headers.get('location'), `/#point/${key}`)
    assert.notEqual(client.cookie, pendingCookie, 'successful identity owns a new session')
    const me = await progress(client)
    assert.equal(me.scannedPointKey, activity.enabled ? key : null)
    assert.equal(me.totalCount, activity.points.length)
    return me
  }
  const save = async (client, key) => {
    const response = await uploadFile(baseUrl, client, key, bytes)
    assert.equal(response.status, 200)
    assert.equal(Object.hasOwn(response.payload.data, 'scannedPointKey'), false, 'mutation payload need not include eligibility')
    return response.payload.data
  }
  const ownPhoto = async (client, key) => {
    const response = await fetch(`${baseUrl}/api/me/photos/${key}`, { headers: { cookie: client.cookie } })
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) }
  }

  const a = browser(baseUrl)
  await enter(a, 'entry-a', 'p01')
  assert.equal((await save(a, 'p01')).completedCount, 1)
  const firstPhoto = (await ownPhoto(a, 'p01')).bytes
  const original = await findOrCreateUser(pool, 'simulated-entry-a')
  const noSharedCookie = browser(baseUrl)
  assert.equal((await enter(noSharedCookie, 'entry-a', 'p02')).completedCount, 1)
  assert.equal((await save(noSharedCookie, 'p02')).completedCount, 2)
  const third = await enter(a, 'entry-a', 'p03')
  assert.equal(third.userLabel, `CQ${String(original.id).padStart(6, '0')}`)
  assert.equal(third.completedCount, 2, 'OAuth/scan never optimistically counts the third point')
  assert.equal((await save(a, 'p03')).completedCount, 3)
  const [rows] = await pool.execute('SELECT id, claim_code FROM users WHERE openid = ?', ['simulated-entry-a'])
  assert.equal(rows.length, 1); assert.equal(rows[0].claim_code, original.claim_code)
  assert.deepEqual((await ownPhoto(a, 'p01')).bytes, firstPhoto)
  assert.equal((await enter(a, 'entry-a', 'p01')).completedCount, 3)
  assert.equal((await save(a, 'p01')).completedCount, 3)
  assert.deepEqual((await ownPhoto(a, 'p01')).bytes, firstPhoto, 'repeat retains the first stored image')
  ok('Direct OAuth: cold/no-shared-cookie entry, same OpenID/claim code/old photos, real 2/N -> saved 3/N and completed-point idempotence')

  const b = await enter(a, 'entry-b', 'p03') // Intentionally brings A cookie into B OAuth.
  assert.notEqual(b.userLabel, third.userLabel)
  assert.equal(b.completedCount, 0); assert.equal(b.claimedAt, null)
  assert.equal((await ownPhoto(a, 'p01')).status, 404)
  assert.equal((await ownPhoto(a, 'p03')).status, 404)
  assert.equal((await uploadFile(baseUrl, a, 'p04', bytes)).status, 403)
  await a.request('/#point/p04')
  assert.equal((await progress(a)).scannedPointKey, 'p03')
  const expired = browser(baseUrl); expired.cookie = a.cookie
  const signed = decodeURIComponent(expired.cookie.slice('changqi.sid='.length))
  const sid = signed.slice(2, signed.lastIndexOf('.'))
  await pool.execute('UPDATE sessions SET expires = 1 WHERE session_id = ?', [sid])
  assert.equal((await expired.request('/api/me')).status, 401)
  assert.equal((await enter(expired, 'entry-a', 'p03')).completedCount, 3)
  const viaMenu = browser(baseUrl)
  assert.equal((await oauth(viaMenu, 'entry-a')).userLabel, third.userLabel)
  assert.equal((await progress(viaMenu)).scannedPointKey, null, 'a menu/hash view alone does not grant a point')
  ok('Account switch A -> B replaces identity, photos and eligibility; expired/direct/menu entry restores the same actual user without trusting hash or browser identity')

  const expectFailure = async (client, state, code, expected, key = 'p03') => {
    const result = await callback(client, state, code)
    assert.notEqual(result.status, 302)
    assert.equal(result.headers.get('location'), null)
    assert.match(result.text, new RegExp(expected))
    assert.ok(result.text.includes(`href="/q/${key}"`), 'manual retry retains only a configured original point')
    assert.doesNotMatch(result.text, /http-equiv="refresh"|window.location|simulated-secret/)
    assert.equal((await client.request('/api/me')).status, 401)
  }
  for (const code of ['', 'invalid-code', 'network-failure', 'non-json']) {
    const client = browser(baseUrl), state = await begin(client)
    await expectFailure(client, state, code, code ? 'WECHAT_UNAVAILABLE' : 'AUTH_CANCELLED')
  }
  const wrong = browser(baseUrl), validState = await begin(wrong)
  await expectFailure(wrong, `f${validState.slice(1)}` === validState ? `e${validState.slice(1)}` : `f${validState.slice(1)}`, 'entry-a', 'OAUTH_STATE_INVALID')
  const noCookies = browser(baseUrl), noCookieState = await begin(noCookies)
  noCookies.cookie = ''
  await expectFailure(noCookies, noCookieState, 'entry-a', 'OAUTH_STATE_INVALID')
  const forged = browser(baseUrl)
  await expectFailure(forged, `${'0'.repeat(48)}P703033`, 'entry-a', 'OAUTH_STATE_INVALID')
  const once = browser(baseUrl)
  await enter(once, 'entry-once')
  await expectFailure(once, await begin(once), 'entry-once', 'WECHAT_UNAVAILABLE')
  const replay = browser(baseUrl), replayState = await begin(replay)
  assert.equal((await callback(replay, replayState, 'entry-a')).status, 302)
  await expectFailure(replay, replayState, 'entry-a', 'OAUTH_STATE_INVALID')
  assert.equal((await browser(baseUrl).request('/q/missing', { headers: wechatHeaders })).status, 404)
  assert.equal((await browser(baseUrl).request('/auth/wechat?returnTo=%2Fq%2Fp03')).status, 400)
  ok('OAuth invalid/reused code, bad/replayed state, provider errors and cookie rejection stop on an error page with safe point retry; fake UA/state does not authenticate')

  const originalSet = store.set
  try {
    const client = browser(baseUrl)
    store.set = function (id, data, done) { return data.oauth ? done(new Error('SIMULATED pending-session save failure')) : originalSet.call(this, id, data, done) }
    const result = await client.request('/q/p03', { headers: wechatHeaders })
    assert.equal(result.status, 500); assert.match(result.text, /SAVE_FAILED/); assert.ok(result.text.includes('href="/q/p03"'))
    store.set = originalSet
    const state = await begin(client)
    store.set = function (id, data, done) { return data.userId ? done(new Error('SIMULATED identity save failure')) : originalSet.call(this, id, data, done) }
    await expectFailure(client, state, 'entry-a', 'SAVE_FAILED')
  } finally { store.set = originalSet }
  const originalGet = store.get
  try {
    const client = browser(baseUrl); await enter(client, 'entry-a')
    let reads = 0
    store.get = function (_id, done) { reads++; done(new Error('SIMULATED session load failure')) }
    const outside = await client.request('/q/p03')
    assert.equal(outside.status, 200); assert.equal(reads, 0)
    assert.match(outside.text, /请在微信内打开/)
    const inside = await client.request('/q/p03', { headers: wechatHeaders })
    assert.equal(inside.status, 500); assert.equal(reads, 1)
    assert.ok(inside.text.includes('href="/q/p03"')); assert.equal(inside.headers.get('location'), null)
  } finally { store.get = originalGet }
  ok('Actual MySQL session adapter fault injection: pending/save/load failures never report success; external stale-cookie /q never loads storage')

  const priorEnabled = activity.enabled
  try {
    activity.enabled = false
    const closed = browser(baseUrl)
    const state = await enter(closed, 'entry-a')
    assert.equal(state.completedCount, 3); assert.equal(state.scannedPointKey, null)
    assert.equal((await ownPhoto(closed, 'p01')).status, 200)
    assert.equal((await uploadFile(baseUrl, closed, 'p04', bytes)).status, 409)
    assert.equal((await closed.request('/api/me/claim', { body: {} })).status, 409)
  } finally { activity.enabled = priorEnabled }
  const claimed = browser(baseUrl)
  const originalClaim = await oauth(claimed, 'a3-a') // Existing A3 fixture already claimed; do not change statistics here.
  assert.ok(originalClaim.claimedAt)
  const recoveredClaim = await enter(claimed, 'a3-a', 'p01')
  assert.equal(recoveredClaim.claimedAt, originalClaim.claimedAt)
  assert.equal(recoveredClaim.claimUrl, originalClaim.claimUrl)
  const publicData = (await browser(baseUrl).request(`/api${new URL(recoveredClaim.claimUrl).pathname}`)).payload.data
  assert.equal(Object.hasOwn(publicData, 'scannedPointKey'), false)
  ok('Closed activity identifies and displays old photos without granting uploads/first claim; already-claimed direct entry preserves first state and public response boundary')

  const ui = browser(baseUrl)
  for (const key of ['p01', 'p02']) { await enter(ui, 'entry-ui-a', key); await save(ui, key) }
  return {
    verifyUi: async () => {
      const current = browser(baseUrl)
      const state = await oauth(current, 'entry-ui-a')
      assert.equal(state.completedCount, 3)
      assert.equal((await ownPhoto(current, 'p03')).status, 200)
    }
  }
}

export async function checkEntryBrowser({ call, evaluate, click, waitFor, ready, capture, observeEvent, origin, samplePath, totalCount, verifyUi }) {
  await call('Emulation.setUserAgentOverride', { userAgent: 'MicroMessenger/8.0 SIMULATED direct-entry Chrome' })
  await call('Network.setBlockedURLs', { urls: ['*://open.weixin.qq.com/*', '*://api.weixin.qq.com/*', '*://res.wx.qq.com/*'] })
  const enter = async (key, code, clear = false) => {
    if (clear) await call('Network.clearBrowserCookies')
    let authorization
    const stop = observeEvent('Network.requestWillBeSent', ({ request }) => {
      if (request.url.startsWith('https://open.weixin.qq.com/connect/oauth2/authorize?')) authorization = new URL(request.url)
    })
    try {
      await call('Page.navigate', { url: `${origin}/q/${key}` })
      for (let n = 0; !authorization && n < 100; n++) await delay(50)
      assert.ok(authorization, 'actual browser /q navigation starts the existing OAuth flow')
      assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/auth/callback`)
      // External WeChat is blocked by the shared harness. Supply its simulated code to the real callback.
      await call('Page.navigate', { url: `${origin}/auth/callback?state=${authorization.searchParams.get('state')}&code=${code}` })
      await waitFor(`location.pathname === '/' && location.hash === '#point/${key}' && document.querySelector('.point-detail')`, 'callback directly renders the requested point')
    } finally { stop() }
  }
  const progress = () => evaluate(`document.querySelector('.point-count')?.textContent.trim()`)
  const injected = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.wx.ready = callback => { window.__entrySdkReady = callback };
    window.__entryFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await window.__entryFetch(...args);
      if (args[0] === '/api/me') await new Promise(resolve => { window.__entryRelease = resolve });
      return response;
    };
  ` })
  try {
    await enter('p03', 'entry-ui-a', true)
    await waitFor('window.__entryRelease && document.body.textContent.includes("正在读取漫游记录")', 'direct-entry real identity response held')
    await capture('entry-loading')
    await evaluate('window.__entryRelease(); window.fetch = window.__entryFetch')
    await waitFor('document.querySelector("input[type=file]") && window.__entrySdkReady', 'native upload exists before wx.ready')
    assert.equal(await progress(), `2/${totalCount}`)
    assert.equal(await evaluate('document.querySelector("input[type=file]").disabled'), false)
    assert.equal(await evaluate('Boolean(window.__simulatedScan)'), false, 'there was no second scan')
    await capture('entry-upload')
    await evaluate('window.__simulatedSdkError({errMsg:"SIMULATED config:fail"})')
    await waitFor('document.querySelector(".scan-help")?.textContent.includes("初始化失败") || document.querySelector(".scan-help")?.textContent.includes("准备超时")', 'scanner-only failure')
    assert.equal(await progress(), `2/${totalCount}`)
    assert.equal(await evaluate('document.querySelector("input[type=file]").disabled'), false)
    await capture('entry-sdk-error-upload')
    const root = await call('DOM.getDocument')
    const input = await call('DOM.querySelector', { nodeId: root.root.nodeId, selector: 'input[type=file]' })
    await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [samplePath] })
    await waitFor('document.querySelector(".local-preview")?.naturalWidth > 0', 'direct-entry native photo preview')
    assert.equal(await progress(), `2/${totalCount}`)
    await click('提交现场照片')
    await waitFor(`document.querySelector('.saved-photo')?.naturalWidth > 0 && document.querySelector('.point-count')?.textContent.trim() === '3/${totalCount}'`, 'actual direct third photo saved')
    await capture('entry-completed')
    await verifyUi()
  } finally { await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }) }

  // A's cookie is intentionally retained; OAuth B must replace all displayed identity/photo state.
  await enter('p03', 'entry-ui-b')
  await waitFor(`document.querySelector('input[type=file]') && document.querySelector('.point-count')?.textContent.trim() === '0/${totalCount}'`, 'A cookie yields B identity')
  assert.equal(await evaluate('Boolean(document.querySelector(".saved-photo, .local-preview"))'), false)
  assert.equal(await evaluate(`fetch('/api/me/photos/p03').then(r=>r.status)`), 404)
  await ready()
  await evaluate(`window.__entryFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.__entryFetch(...args);if(args[0]==='/api/me')await new Promise(resolve=>window.__lateEntryMe=resolve);return response};window.dispatchEvent(new Event('pageshow'))`)
  await waitFor('window.__lateEntryMe', 'old /api/me is in flight')
  await click('扫一扫打卡')
  await evaluate(`window.__simulatedScan.success({resultStr:${JSON.stringify(`${origin}/q/p04`)}})`)
  await waitFor(`document.querySelector('input[type=file]')?.id === 'photo-p04'`, 'newer real in-page scan gets p04')
  await evaluate('window.__lateEntryMe();window.fetch=window.__entryFetch')
  await delay(150)
  assert.equal(await evaluate('document.querySelector("input[type=file]")?.id'), 'photo-p04', 'late state cannot replace the newer point')
  await call('Page.reload')
  await waitFor('document.querySelector("input[type=file]")?.id === "photo-p04"', 'refresh restores the server qualification')
  await evaluate('location.hash="point/p05"')
  await waitFor('document.querySelector(".point-detail")?.dataset.pointKey === "p05"', 'map-equivalent hash view')
  assert.equal(await evaluate('Boolean(document.querySelector("input[type=file]"))'), false)
  assert.equal(await evaluate(`fetch('/api/me').then(r=>r.json()).then(r=>r.data.scannedPointKey)`), 'p04')
  await enter('p03', 'entry-ui-a', true)
  await waitFor('document.querySelector(".saved-photo")?.naturalWidth > 0', 'repeat direct entry restores the first image')
  assert.equal(await progress(), `3/${totalCount}`)
  await enter('p01', 'a3-a')
  await waitFor('document.querySelector(".saved-photo")?.naturalWidth > 0 && document.body.textContent.includes("已领取礼品")', 'already-claimed direct entry')
  await capture('entry-claimed')

  // Missing cookies still preserve a safe manual retry point, without authenticating from the hint.
  await call('Network.clearBrowserCookies')
  await call('Page.navigate', { url: `${origin}/auth/callback?state=${'0'.repeat(48)}P703033&code=entry-ui-a` })
  await waitFor('document.querySelector("[data-error-code=OAUTH_STATE_INVALID]")', 'direct entry error does not redirect again')
  assert.equal(await evaluate('document.querySelector("a").getAttribute("href")'), '/q/p03')
  await capture('entry-auth-error')
}
