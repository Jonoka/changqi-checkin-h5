import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Reuses the existing isolated MySQL / Chrome suite. Only WeChat and network faults are simulated.
export async function checkPhotoAuthBrowser({ call, evaluate, waitFor, buttonExpression, observeEvent, capture, origin, activity, auth, pngPath, samplePath }) {
  const key = activity.points[0].key, n = activity.points.length
  const panel = '.saved-photo-panel', editor = '.replacement-editor'
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const marks = () => evaluate(`Object.keys(sessionStorage).filter(k=>k.startsWith('changqi.photo-replacement:')).map(k=>JSON.parse(sessionStorage.getItem(k)))`)
  const setCookie = cookie => call('Network.setCookie', { name: 'changqi.sid', value: cookie.slice('changqi.sid='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  const photos = count => waitFor(`document.querySelectorAll('img.saved-photo').length === ${count} && [...document.querySelectorAll('img.saved-photo')].every(i=>i.naturalWidth>0)`, 'authenticated saved photos')
  const phase = value => waitFor(`document.querySelector(${JSON.stringify(panel)})?.dataset.phase === ${JSON.stringify(value)}`, `auth recovery ${value}`)
  const choose = async filename => {
    const root = await call('DOM.getDocument')
    const input = await call('DOM.querySelector', { nodeId: root.root.nodeId, selector: `${editor} input[type=file]` })
    assert.ok(input.nodeId)
    await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [filename] })
  }
  const locked = async () => {
    assert.equal(await evaluate('Boolean(document.querySelector(".claim-qr"))'), false)
    assert.equal(await evaluate('document.querySelector(".back-button")?.disabled'), true)
    assert.equal(await evaluate('Boolean(document.querySelector(".claim-action button:not(:disabled)"))'), false)
  }
  const authRequired = async view => {
    await waitFor(buttonExpression('重新识别微信身份'), 'explicit reauthentication entry after photo 401')
    assert.equal(await evaluate(`${buttonExpression('重新识别微信身份')}.disabled`), false)
    await waitFor('!document.querySelector(".saved-photo, .local-preview, dialog[open], .claim-qr")', 'old identity images and QR removed')
    await locked()
    assert.equal(await evaluate(`${buttonExpression('重试读取身份')}.disabled`), true, 'ordinary refresh stays locked')
    await evaluate(`location.hash=${JSON.stringify(view === '#claim' ? '#point/p02' : '#claim')}`)
    await waitFor(`location.hash === ${JSON.stringify(view)}`, 'authentication keeps original return view locked')
  }
  const requests = []
  const stopRequests = observeEvent('Network.requestWillBeSent', ({ request }) => {
    const url = new URL(request.url)
    if (url.origin === origin && url.pathname.startsWith('/api/')) requests.push({ method: request.method, path: url.pathname })
  })
  const writes = () => requests.filter(r=>r.method === 'PUT').length
  const authorize = async (code, view) => {
    let authorization
    const stop = observeEvent('Network.requestWillBeSent', ({ request }) => {
      if (request.url.startsWith('https://open.weixin.qq.com/connect/oauth2/authorize?')) authorization = new URL(request.url)
    })
    const priorWrites = writes(), from = requests.length
    try {
      await evaluate(`${buttonExpression('重新识别微信身份')}.click()`)
      for (let i = 0; !authorization && i < 100; i++) await delay(50)
      assert.ok(authorization, 'manual button starts actual existing OAuth route, even while business is locked')
      assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/auth/callback`)
      assert.equal(authorization.searchParams.get('scope'), 'snsapi_base')
      await call('Page.navigate', { url: `${origin}/auth/callback?state=${authorization.searchParams.get('state')}&code=${code}` })
      await waitFor(`location.pathname === '/' && location.hash === ${JSON.stringify(view)} && document.querySelector('.saved-photo-panel')`, 'OAuth returns to original view with authenticated owner')
      await waitFor('document.querySelector(".saved-photo-panel")?.getAttribute("aria-busy") === "false"', 'server revision reconciliation finishes')
      assert.ok(requests.slice(from).some(r=>r.path === '/api/me/photos' && r.method === 'GET'), 'read server revision before any possible retry')
      assert.equal(writes(), priorWrites, 'authorization never automatically retransmits a photo')
    } finally { stop() }
  }
  const openClaim = async label => {
    await call('Page.navigate', { url: `${origin}/?photoAuth=${label}#claim` })
    await waitFor(`location.search === '?photoAuth=${label}' && document.querySelector('.voucher-owner')?.textContent.includes(${JSON.stringify(auth.ownerA)})`, 'new authenticated claim document')
    await photos(n)
    await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'claim QR available')
  }
  const begin = async filename => { await click('.change-photo'); await choose(filename); await locked() }
  const assertMarker = marker => {
    assert.equal(marker.userLabel, auth.ownerA); assert.equal(marker.pointKey, key)
    assert.deepEqual(Object.keys(marker).sort(), ['v', 'userLabel', 'pointKey', 'expectedRevision', 'replacementId', 'fileHash', 'view'].sort())
    assert.doesNotMatch(JSON.stringify(marker), /openid|cookie|data:image|photo_path/i)
  }
  try {
    await setCookie(auth.cookie); await openClaim('preflight')
    const baseline = await auth.invariant(), claimUrl = baseline.progress.claimUrl
    await begin(pngPath); await capture('photo-auth-editing')
    const beforePreflight = writes()
    await call('Network.clearBrowserCookies')
    await click('.confirm-replacement'); await authRequired('#claim')
    assert.deepEqual(await marks(), []); assert.equal(writes(), beforePreflight, 'preflight 401 sends no PUT and invents no pending operation')
    await capture('photo-auth-required')
    await authorize('photo-test-auth-a', '#claim'); await photos(n)
    assert.deepEqual(await auth.invariant(), baseline)

    // PUT really reaches the protected API without a cookie, after a successful preflight.
    await evaluate(`location.hash='point/${key}'`); await photos(1)
    await begin(pngPath)
    await evaluate(`window.__authFetch=window.fetch;window.fetch=(url,options={})=>window.__authFetch(url,options.method==='PUT'?{...options,credentials:'omit'}:options)`)
    await click('.confirm-replacement'); await authRequired(`#point/${key}`)
    const [notSaved] = await marks(); assertMarker(notSaved); assert.equal(notSaved.view, 'point')
    assert.equal((await auth.read()).photos[0].revision, notSaved.expectedRevision)
    await authorize('photo-test-auth-a', `#point/${key}`); await phase('unknown'); await photos(1); await locked()
    assert.deepEqual(await marks(), [notSaved]); assert.equal(await evaluate('Boolean(document.querySelector(".local-preview"))'), false)
    // Repeated 401 does not erase/replace the original operation or create a redirect loop.
    for (let i = 0; i < 2; i++) {
      await call('Network.clearBrowserCookies'); await click('.replacement-editor .verify-button'); await authRequired(`#point/${key}`)
      await delay(150); assert.deepEqual(await marks(), [notSaved])
      await authorize('photo-test-auth-a', `#point/${key}`); await phase('unknown'); await locked()
    }
    await capture('photo-auth-pending')
    await choose(samplePath); await click('.confirm-replacement'); await phase('unknown')
    assert.match(await evaluate('document.querySelector(".saved-photo-panel").textContent'), /不是本次修改的原文件/)
    await choose(pngPath); await click('.confirm-replacement'); await phase('success')
    assert.equal((await auth.read()).photos[0].revision, notSaved.replacementId)
    assert.deepEqual(await marks(), []); assert.deepEqual(await auth.invariant(), baseline)

    // Actual successful PUT, then the browser loses its session before any reconciliation read.
    await openClaim('saved-response-loss'); await begin(samplePath)
    await evaluate(`window.__authFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.__authFetch(...args);if(args[1]?.method==='PUT'){window.__authSavedStatus=response.status;await new Promise(resolve=>window.__authRelease=resolve);throw new TypeError('SIMULATED response lost after save')}return response}`)
    await click('.confirm-replacement'); await waitFor('window.__authRelease', 'real PUT finished before response loss')
    assert.equal(await evaluate('window.__authSavedStatus'), 200)
    await call('Network.clearBrowserCookies'); await evaluate('window.__authRelease()'); await authRequired('#claim')
    const [saved] = await marks(); assertMarker(saved)
    assert.equal((await auth.read()).photos[0].revision, saved.replacementId)
    await authorize('photo-test-auth-a', '#claim'); await phase('success'); await photos(n)
    await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'server-confirmed photo unlocks voucher')
    assert.deepEqual(await marks(), []); assert.equal((await auth.invariant()).progress.claimUrl, claimUrl)
    await capture('photo-auth-recovered')

    // No PUT reached the server; auth failure during reconciliation must keep the original pending ID.
    await begin(pngPath)
    await evaluate(`window.__authFetch=window.fetch;window.__authAttempted=false;window.fetch=(url,options={})=>{if(options.method==='PUT'){window.__authAttempted=true;return Promise.reject(new TypeError('SIMULATED unsent request'))}return window.__authFetch(url,window.__authAttempted&&url==='/api/me/photos'?{...options,credentials:'omit'}:options)}`)
    await click('.confirm-replacement'); await authRequired('#claim')
    const [isolated] = await marks(); assertMarker(isolated)
    assert.equal((await auth.read()).photos[0].revision, isolated.expectedRevision)
    const beforeB = writes()
    await authorize('photo-test-auth-b', '#claim'); await photos(n)
    assert.match(await evaluate('document.querySelector(".voucher-owner").textContent'), new RegExp(auth.ownerB))
    assert.equal(await evaluate('Boolean(document.querySelector(".replacement-editor"))'), false)
    assert.deepEqual(await marks(), [isolated]); assert.equal(writes(), beforeB)
    assert.equal(await evaluate(`(async()=>{const b=await(await fetch(document.querySelector('img.saved-photo').src)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('')})()`), await auth.otherDigest())
    await capture('photo-auth-other-owner')
    // A photo-byte 401 itself reaches the same recovery path, not just metadata and PUT errors.
    await evaluate(`window.__authFetch=window.fetch;window.fetch=(url,options={})=>window.__authFetch(url,String(url).startsWith('/api/me/photos/${key}?')?{...options,credentials:'omit'}:options);window.dispatchEvent(new Event('pageshow'))`)
    await authRequired('#claim')
    await authorize('photo-test-auth-a', '#claim'); await phase('unknown'); await photos(n); await locked()
    assert.deepEqual(await marks(), [isolated], 'A pending marker survives B and returns unchanged only for A')
    await choose(pngPath); await click('.confirm-replacement'); await phase('success'); await photos(n)
    assert.equal((await auth.read()).photos[0].revision, isolated.replacementId)
    assert.deepEqual(await marks(), []); assert.deepEqual(await auth.invariant(), baseline)

    // Saving succeeded but the subsequent new image read requires login: keep the pending ID until bytes load.
    await begin(samplePath)
    await evaluate(`window.__authFetch=window.fetch;window.__afterPut=false;window.fetch=async(url,options={})=>{const response=await window.__authFetch(url,window.__afterPut&&String(url).startsWith('/api/me/photos/${key}?')?{...options,credentials:'omit'}:options);if(options.method==='PUT')window.__afterPut=true;return response}`)
    await click('.confirm-replacement'); await authRequired('#claim')
    const [imagePending] = await marks(); assertMarker(imagePending)
    assert.equal((await auth.read()).photos[0].revision, imagePending.replacementId)
    await authorize('photo-test-auth-a', '#claim'); await phase('success'); await photos(n)
    assert.deepEqual(await marks(), [])

    // Owner mismatch on preflight is a typed authentication boundary; do not display B's inventory as A.
    await begin(pngPath); await setCookie(auth.otherCookie)
    const beforeOwner = writes()
    await click('.confirm-replacement'); await authRequired('#claim')
    assert.match(await evaluate('document.body.textContent'), /用户已变化|身份已变化/)
    assert.equal(writes(), beforeOwner); assert.deepEqual(await marks(), [])
    await authorize('photo-test-auth-a', '#claim'); await photos(n)
    assert.deepEqual(await auth.invariant(), baseline)
    assert.equal(await evaluate(`(async()=>{const b=await(await fetch(document.querySelector('img.saved-photo').src)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('')})()`), await auth.digest())
    // Use one reader so a second owner-change error cannot incidentally discard the held identity read.
    // If that already-running idle identity refresh also fails, the explicit login entry must stay usable.
    await evaluate(`location.hash='point/${key}'`); await photos(1)
    await setCookie(auth.otherCookie)
    await evaluate(`window.__authFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.__authFetch(...args);if(args[0]==='/api/me'){await new Promise(resolve=>window.__idleOwnerRelease=resolve);throw new TypeError('SIMULATED idle identity read loss')}return response};window.dispatchEvent(new Event('pageshow'))`)
    await waitFor('window.__idleOwnerRelease && !document.querySelector(".saved-photo")', 'old owner removed before idle identity failure')
    await evaluate('window.__idleOwnerRelease()'); await authRequired(`#point/${key}`)
    assert.deepEqual(await marks(), [])
    await authorize('photo-test-auth-a', `#point/${key}`); await photos(1)
    await evaluate("location.hash='claim'"); await photos(n)
    assert.deepEqual(await auth.invariant(), baseline)
    await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'final recovered voucher is usable')
    await evaluate(`${buttonExpression('我已领取礼品')}.click()`)
    await evaluate(`${buttonExpression('确认已领取')}.click()`)
    await waitFor('document.querySelector(".claimed-status")', 'claim after photo recovery')
    const claimed = await auth.invariant()
    assert.equal(Number(claimed.claimedCount), Number(baseline.claimedCount) + 1)
    assert.deepEqual(claimed.rows, baseline.rows)
    assert.equal((await auth.claim()).status, 200)
    assert.deepEqual(await auth.invariant(), claimed, 'repeat staff confirmation never changes first claim or count')
    assert.equal(await evaluate('Boolean(document.querySelector(".claim-qr"))'), false)
  } finally { stopRequests() }
}
