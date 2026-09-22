import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

// Uses the existing Chrome CDP connection and the same isolated MySQL application.
// This records real rendered states, not substituted screenshots or a second test platform.
export function createA4Capture({ call, evaluate, directory }) {
  const records = []
  return async function capture(name) {
    assert.match(name, /^[a-z0-9-]+$/)
    for (const width of [390, 430]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      await evaluate(`[...document.querySelectorAll('img[loading="lazy"]')].forEach(image => image.loading = 'eager')`)
      await evaluate(`document.fonts.ready.then(() => Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.addEventListener('load', resolve, {once:true}); image.addEventListener('error', resolve, {once:true}); setTimeout(resolve, 2000) }))))`)
      assert.equal(await evaluate('document.documentElement.scrollWidth'), width, `${name}: no horizontal overflow at ${width}px`)
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('img[src^="/art/"], img.claim-qr, img.saved-photo')].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.className)`), [], `${name}: decorative and saved images loaded`)
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('button')].filter(button => button.getClientRects().length && button.getBoundingClientRect().height < 43).map(button => button.textContent.trim())`), [], `${name}: visible buttons have touch-sized targets`)
      const metrics = await call('Page.getLayoutMetrics')
      const size = metrics.cssContentSize
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(size.height), scale: 1 } })
      const filename = `a4-${name}-${width}.png`
      await fs.writeFile(path.join(directory, filename), Buffer.from(screenshot.data, 'base64'))
      records.push({ state: name, width, height: Math.ceil(size.height), file: filename })
    }
    await fs.writeFile(path.join(directory, 'a4-screenshots.json'), JSON.stringify({ environment: 'Chrome + isolated MySQL; WeChat and injected network faults simulated; not device acceptance', screenshots: records }, null, 2))
  }
}

export async function pointerClick({ call, evaluate }, selector) {
  const position = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) throw new Error('Expected an enabled target');
    button.scrollIntoView({block:'center',behavior:'instant'});
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    if (!button.contains(document.elementFromPoint(x,y))) throw new Error('Pointer target is covered');
    return {x,y};
  })()`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', clickCount: 1 })
}

export async function checkA4Pages({ call, evaluate, click, waitFor, capture, origin, cookie, credential, activity }) {
  const originalEnabled = activity.enabled
  const originalPoints = activity.points
  const setCookie = () => call('Network.setCookie', { name: 'changqi.sid', value: cookie.slice('changqi.sid='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  try {
    await call('Network.clearBrowserCookies')
    await call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 A4-NORMAL-BROWSER-TEST' })
    await call('Page.navigate', { url: origin })
    await waitFor('document.body.textContent.includes("请在微信内打开") && document.querySelector(".map-point")', 'normal browser home')
    assert.equal(await evaluate('Boolean(document.querySelector(".point-count"))'), false, 'No fake logged-out progress')
    await capture('logged-out')

    // Delay a real 401 response to observe identity loading; then fail the read and recover by retry.
    const identityInjection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__a4Fetch=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/me'){const response=await window.__a4Fetch(...args);await new Promise(resolve=>window.__a4Resume=resolve);throw new TypeError('SIMULATED identity read failure')}return window.__a4Fetch(...args)}` })
    await call('Page.navigate', { url: origin })
    await waitFor('window.__a4Resume && document.body.textContent.includes("正在恢复本人身份")', 'identity loading')
    await capture('identity-loading')
    await evaluate('window.__a4Resume()')
    await waitFor('document.body.textContent.includes("网络暂时不可用")', 'identity read failure')
    assert.equal(await evaluate('Boolean(document.querySelector(".point-count"))'), false)
    await capture('identity-error')
    await evaluate('window.fetch=window.__a4Fetch')
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: identityInjection.identifier })
    await click('重试读取身份')
    await waitFor('document.body.textContent.includes("身份已失效")', 'real 401 after retry')

    for (const [url, text, label] of [[`${origin}/q/p01`, '印象芦苞', 'guide'], [`${origin}/q/invalid`, '地点不存在', 'guide-invalid'], [`${origin}/auth/callback?state=bad`, '授权未完成', 'auth-error']]) {
      await call('Page.navigate', { url })
      await waitFor(`document.body.textContent.includes(${JSON.stringify(text)})`, label)
      await capture(label)
    }
    await setCookie()
    await call('Page.navigate', { url: `${origin}/q/p01` })
    await waitFor('document.querySelector(".guide-steps")', 'logged-in guide still displayed')
    assert.equal(await evaluate('Boolean(document.querySelector("input[type=file], .scan-controls"))'), false)

    activity.enabled = false
    await call('Page.navigate', { url: origin })
    await waitFor('document.querySelector(".point-count") && document.body.textContent.includes("活动暂未开放或已结束")', 'closed activity still restores progress')
    assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "扫一扫打卡").disabled'), true)
    await capture('activity-closed')
    activity.enabled = originalEnabled

    // A distinct test configuration proves map/list/N are data-driven. Never modify the on-disk activity.
    activity.points = [...originalPoints, { key: 'a4-config-test', name: '配置测试地点', image: null, displayOrder: originalPoints.length + 1 }]
    await call('Page.navigate', { url: origin })
    await waitFor(`document.querySelectorAll('.map-point').length === ${activity.points.length}`, 'dynamic map count')
    assert.equal(await evaluate('document.querySelectorAll(".point-button").length'), activity.points.length)
    assert.match(await evaluate('document.querySelector(".point-count").textContent'), new RegExp(`/${activity.points.length}$`))
    activity.points = originalPoints

    // Transport failure injection, not fabricated success data; the retry then reaches the real API.
    const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__a4Fetch=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/activity')throw new TypeError('SIMULATED A4 configuration network failure');return window.__a4Fetch(...args)}` })
    await call('Page.navigate', { url: origin })
    await waitFor('document.querySelector(".error-card")', 'activity fetch error')
    await capture('activity-error')
    await evaluate('window.fetch=window.__a4Fetch')
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
    await click('重新加载')
    await waitFor('document.querySelector(".map-point")', 'real activity retry')

    await call('Network.setExtraHTTPHeaders', { headers: { Authorization: credential } })
    await call('Page.navigate', { url: `${origin}/stats` })
    await waitFor('document.querySelector("[data-stats-count]")', 'protected statistics')
    await capture('stats')
    await call('Network.setExtraHTTPHeaders', { headers: {} })
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await call('Page.navigate', { url: origin })
    await waitFor('document.querySelector(".map-point")', 'reduced-motion home')
    assert.equal(await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), true)
    await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true })
    assert.equal(await evaluate('document.documentElement.scrollWidth'), 320, '320px compact home remains usable')
    await call('Emulation.setEmulatedMedia', { features: [] })
  } finally {
    activity.enabled = originalEnabled
    activity.points = originalPoints
    await call('Network.setExtraHTTPHeaders', { headers: {} })
  }
}
