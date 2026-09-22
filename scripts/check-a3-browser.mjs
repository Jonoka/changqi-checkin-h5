import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

// Reuse the existing Chrome connection. WeChat stays simulated; claims/COUNT use real MySQL.
export async function checkA3Browser({ call, evaluate, click, waitFor, ready, buttonExpression, origin, directory,
  selfCookie, staffCookie, incompleteCookie, selfUrl, staffUrl, credential, assertUiClaim, countClaimed, capture = async () => {} }) {
  const setCookie = (cookie) => call('Network.setCookie', { name: 'changqi.sid', value: cookie.slice('changqi.sid='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  const claimed = () => waitFor('document.querySelector(".claimed-status")', 'server-confirmed claim display')
  const locked = (label) => evaluate(`${buttonExpression(label)}.disabled`)
  const before = await countClaimed()

  await setCookie(incompleteCookie); await call('Page.navigate', { url: origin }); await ready()
  assert.equal(await evaluate('Boolean(document.querySelector(".claim-qr"))'), false)
  assert.equal(await evaluate(`Boolean(${buttonExpression('我已领取礼品')})`), false)
  await setCookie(selfCookie); await call('Page.navigate', { url: origin }); await ready()
  await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'real generated claimant QR')
  assert.equal(await evaluate('document.querySelector(".claim-panel a").href'), selfUrl)
  const firstQr = await evaluate('document.querySelector(".claim-qr").src')
  await click('刷新本人状态')
  await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'same claim QR after refresh')
  assert.equal(await evaluate('document.querySelector(".claim-qr").src'), firstQr)
  await assertUiClaim('self', false)

  await capture('claim-ready')
  await click('我已领取礼品')
  await capture('claim-confirm')
  await waitFor('document.querySelector("[role=dialog]")', 'self second confirmation')
  assert.match(await evaluate('document.querySelector("[role=dialog]").textContent'), /实际拿到礼品/)
  await click('取消')
  assert.equal(await evaluate('Boolean(document.querySelector("[role=dialog]"))'), false)
  await assertUiClaim('self', false); assert.equal(await countClaimed(), before)

  // Both mutation and read fail before reaching the server. Repeated verification must stay locked.
  await evaluate(`window.__a3Fetch = window.fetch;
    window.fetch = async (...args) => {
      if (args[0] === '/api/me/claim' || args[0] === '/api/me') throw new TypeError('SIMULATED A3 offline');
      return window.__a3Fetch(...args);
    }`)
  await click('我已领取礼品'); await click('确认已领取')
  await waitFor('document.body.textContent.includes("暂时无法确认领取结果")', 'unknown claim response')
  assert.equal(await locked('我已领取礼品'), true)
  await click('核对领取结果')
  await waitFor('document.body.textContent.includes("仍无法确认领取结果")', 'second verification failure')
  assert.equal(await locked('我已领取礼品'), true)
  assert.equal(await evaluate('Boolean(document.querySelector(".claimed-status"))'), false)
  await capture('claim-unknown')
  await assertUiClaim('self', false)
  await evaluate('window.fetch = window.__a3Fetch')
  await click('核对领取结果')
  await waitFor('document.body.textContent.includes("服务器尚未标记领取")', 'verified unclaimed state')
  assert.equal(await locked('我已领取礼品'), false)

  // Hold the response after a real update to prove there is no optimistic success or double submit.
  await evaluate(`window.__a3Writes = 0;
    window.fetch = async (...args) => {
      const response = await window.__a3Fetch(...args);
      if (args[0] === '/api/me/claim') { window.__a3Writes++; await new Promise(resolve => window.__a3Release = resolve); }
      return response;
    }`)
  await click('我已领取礼品'); await click('确认已领取')
  await waitFor('window.__a3Release', 'actual claim saved with response held')
  assert.equal(await evaluate('Boolean(document.querySelector(".claimed-status"))'), false)
  assert.equal(await locked('正在核对领取…'), true)
  await click('正在核对领取…')
  assert.equal(await evaluate('window.__a3Writes'), 1)
  await evaluate('window.__a3Release(); window.fetch = window.__a3Fetch')
  await claimed(); await assertUiClaim('self', true)
  await capture('claim-complete')
  assert.equal(await evaluate('Boolean(document.querySelector(".claim-qr"))'), false)
  const firstTime = await evaluate('document.querySelector(".claimed-status").textContent')
  await call('Page.reload'); await claimed()
  assert.equal(await evaluate('document.querySelector(".claimed-status").textContent'), firstTime)
  assert.equal(await countClaimed(), before + 1)

  // Plain browser without any visitor cookie, staff account, OAuth or WeChat camera.
  await call('Network.clearBrowserCookies')
  await call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 A3-NORMAL-BROWSER-TEST' })
  await call('Page.navigate', { url: staffUrl })
  await waitFor(buttonExpression('已完成奖品派发'), 'anonymous bearer page')
  assert.equal(await evaluate('Boolean(document.querySelector(".photo-panel, .saved-photo, input[type=file]"))'), false)
  assert.doesNotMatch(await evaluate('document.body.textContent'), /请在微信内打开|重新识别微信身份/)
  assert.equal(await evaluate('location.pathname'), new URL(staffUrl).pathname)
  await assertUiClaim('staff', false)
  await click('已完成奖品派发'); await click('取消')
  await capture('staff-ready')
  await assertUiClaim('staff', false)
  await evaluate(`window.__a3Fetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await window.__a3Fetch(...args);
      if (String(args[0]).endsWith('/claim')) throw new TypeError('SIMULATED lost response after actual claim');
      return response;
    }`)
  await click('已完成奖品派发'); await click('确认已派发')
  await claimed()
  assert.match(await evaluate('document.body.textContent'), /已从服务器确认领取成功/)
  await evaluate('window.fetch = window.__a3Fetch')
  await assertUiClaim('staff', true)
  assert.equal(await countClaimed(), before + 2)
  await click('刷新领取状态'); await claimed()
  await capture('staff-complete')
  for (const width of [390, 430]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true)
    const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await fs.writeFile(path.join(directory, `a3-staff-${width}.png`), Buffer.from(image.data, 'base64'))
  }

  await setCookie(staffCookie)
  await call('Page.navigate', { url: origin })
  await claimed()
  assert.equal(await evaluate('Boolean(document.querySelector(".claim-qr"))'), false)
  await evaluate("window.dispatchEvent(new Event('pageshow'))")
  await claimed()
  await call('Page.navigate', { url: `${origin}/r/invalid` })
  await waitFor('document.body.textContent.includes("领取凭证不存在")', 'invalid bearer link')
  await capture('staff-invalid')
  assert.equal(await evaluate(`Boolean(${buttonExpression('已完成奖品派发')})`), false)

  await call('Network.setExtraHTTPHeaders', { headers: { Authorization: credential } })
  await call('Page.navigate', { url: `${origin}/stats` })
  await waitFor('document.querySelector("[data-stats-count]")', 'authenticated statistics page')
  assert.equal(Number(await evaluate('document.querySelector("[data-stats-count]").textContent')), before + 2)
  await click('刷新人数')
  await waitFor('document.querySelector("[data-stats-count]")', 'read-only statistics refresh')
  assert.equal(Number(await evaluate('document.querySelector("[data-stats-count]").textContent')), before + 2)
  await call('Network.setExtraHTTPHeaders', { headers: {} })
}
