import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const versionFiles = [
  'config/activity.json',
  'server/config.js',
  'web/src/App.vue',
  'web/src/VillageMap.vue',
  'web/src/PointArt.vue',
  'web/src/PhotoPanel.vue',
  'web/src/ClaimPanel.vue',
  'web/src/style.css',
  'web/public/art/map-environment.webp',
  'web/public/art/point-p01-gourd.webp',
  'web/public/art/point-p02-hall.webp',
  'web/public/art/point-p03-well.webp',
  'web/public/art/point-p04-banyan.webp',
  'web/public/art/point-p05-summit.webp'
]

async function runtimeVersion() {
  const files = []
  for (const filename of versionFiles) {
    const bytes = await fs.readFile(filename)
    files.push({ path: filename, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })
  }
  return {
    branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    worktree: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim(),
    runtimeSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files
  }
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function gallery(records, version) {
  const currentMap = records.find((record) => record.state === 'home' && record.width === 390)?.mapFile
  const cards = records.map((record) => `<figure><a href="${escapeHtml(record.file)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(record.file)}" alt="${escapeHtml(record.state)} ${record.width}px" loading="lazy"></a><figcaption><strong>${escapeHtml(record.state)}</strong> · ${record.width}px<br><small>${escapeHtml(record.capturedAt)}</small></figcaption></figure>`).join('')
  const comparison = currentMap ? `<h2>原参考地图 / 本轮实际地图</h2><div class="comparison"><figure><a href="../../assets/reference/map.png" target="_blank"><img src="../../assets/reference/map.png" alt="原地图视觉参考"></a><figcaption>assets/reference/map.png · 原图未修改</figcaption></figure><figure><a href="${escapeHtml(currentMap)}" target="_blank"><img src="${escapeHtml(currentMap)}" alt="本轮实际首页地图"></a><figcaption>本轮 390px 实际渲染地图</figcaption></figure></div>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A4 本地视觉复核</title><style>
body{margin:0;padding:24px;background:#f2f1e8;color:#254533;font:15px/1.65 system-ui,-apple-system,sans-serif}main{max-width:1280px;margin:auto}h1,h2{line-height:1.3}code{overflow-wrap:anywhere}.meta{padding:14px 18px;background:#fff;border:1px solid #d6ddce;border-radius:12px}.comparison,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px;align-items:start}.comparison{max-width:920px}.grid figure,.comparison figure{margin:0;padding:10px;background:#fff;border:1px solid #d6ddce;border-radius:12px}.grid img,.comparison img{display:block;width:100%;height:auto}figcaption{padding:9px 3px 2px}small{color:#667568}@media(max-width:600px){body{padding:12px}}
</style></head><body><main><h1>长岐村 A4 本地视觉复核</h1><p>截图来自隔离 MySQL + 本机 Chrome。微信 SDK、微信网络及故障注入为模拟，不是真机验收。</p><div class="meta">分支：<code>${escapeHtml(version.branch)}</code><br>截图基准 HEAD：<code>${escapeHtml(version.head)}</code><br>运行时源码/素材指纹：<code>${escapeHtml(version.runtimeSha256)}</code><br><a href="a4-screenshots.json">查看截图元数据</a></div>${comparison}<h2>实际页面状态</h2><div class="grid">${cards}</div></main></body></html>`
}

// Uses the existing Chrome CDP connection and the same isolated MySQL application.
// These are real rendered Vue/HTTP/SQL states. WeChat SDK/network failures remain explicitly simulated.
export function createA4Capture({ call, evaluate, directory }) {
  const records = []
  const versionPromise = runtimeVersion()
  return async function capture(name) {
    assert.match(name, /^[a-z0-9-]+$/)
    for (const width of [320, 390, 430]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 740 : 844, deviceScaleFactor: 1, mobile: true })
      await evaluate(`[...document.querySelectorAll('img[loading="lazy"]')].forEach(image => image.loading = 'eager')`)
      await evaluate(`document.fonts.ready.then(() => Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.addEventListener('load', resolve, {once:true}); image.addEventListener('error', resolve, {once:true}); setTimeout(resolve, 2000) }))))`)
      assert.equal(await evaluate('document.documentElement.scrollWidth'), width, `${name}: no horizontal overflow at ${width}px`)
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('img[src^="/art/"], img.claim-qr, img.saved-photo')].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.className)`), [], `${name}: required artwork/QR/saved images loaded`)
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('button')].filter(button => button.getClientRects().length && button.getBoundingClientRect().height < 43).map(button => button.textContent.trim())`), [], `${name}: visible buttons have touch-sized targets`)

      const alignment = await evaluate(`(() => {
        const svg=document.querySelector('.map-route'); if(!svg) return [];
        const s=svg.getBoundingClientRect(), vb=svg.viewBox.baseVal, bad=[];
        for(const li of document.querySelectorAll('.map-points li')){
          const button=li.querySelector('.map-point'), r=li.getBoundingClientRect();
          const x=s.left+Number(button.dataset.mapX)/vb.width*s.width;
          const y=s.top+Number(button.dataset.mapY)/vb.height*s.height;
          if(Math.abs((r.left+r.width/2)-x)>1.5 || Math.abs((r.top+r.height/2)-y)>1.5) bad.push(button.dataset.pointKey);
        }
        return bad;
      })()`)
      assert.deepEqual(alignment, [], `${name}: route, landmark and click target use the same coordinate system at ${width}px`)

      const metrics = await call('Page.getLayoutMetrics')
      const size = metrics.cssContentSize
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(size.height), scale: 1 } })
      const filename = `a4-${name}-${width}.png`
      await fs.writeFile(path.join(directory, filename), Buffer.from(screenshot.data, 'base64'))

      let mapFile = null
      if (name === 'home') {
        const box = await evaluate(`(() => { const r=document.querySelector('.village-map')?.getBoundingClientRect(); return r ? {x:Math.floor(r.left+scrollX),y:Math.floor(r.top+scrollY),width:Math.ceil(r.width),height:Math.ceil(r.height),scale:1} : null })()`)
        if (box) {
          const cropped = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: box })
          mapFile = `a4-map-only-${width}.png`
          await fs.writeFile(path.join(directory, mapFile), Buffer.from(cropped.data, 'base64'))
        }
      }

      records.push({ state: name, width, height: Math.ceil(size.height), file: filename, mapFile, capturedAt: new Date().toISOString(), mapAlignmentErrors: alignment })
    }
    const version = await versionPromise
    await fs.writeFile(path.join(directory, 'a4-screenshots.json'), JSON.stringify({
      environment: 'Chrome + isolated MySQL; WeChat SDK/network/fault injection simulated; not real-device acceptance',
      version,
      screenshots: records
    }, null, 2))
    await fs.writeFile(path.join(directory, 'index.html'), gallery(records, version))
  }
}

export async function pointerClick({ call, evaluate }, selector) {
  const position = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) throw new Error('Expected an enabled target: '+${JSON.stringify(selector)});
    button.scrollIntoView({block:'center',behavior:'instant'});
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    if (!button.contains(document.elementFromPoint(x,y))) throw new Error('Pointer target is covered: '+${JSON.stringify(selector)});
    return {x,y};
  })()`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', clickCount: 1 })
}

export async function checkA4LastPoint({ call, evaluate, waitFor, buttonExpression, capture, origin, cookie, samplePath, point, totalCount }) {
  await call('Network.clearBrowserCookies')
  await call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 A4-LAST-POINT MicroMessenger/8.0 (SIMULATED SDK, NOT A DEVICE)' })
  await call('Network.setCookie', { name: 'changqi.sid', value: cookie.slice('changqi.sid='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  await call('Page.navigate', { url: origin })
  await waitFor(`document.querySelector('.point-count')?.textContent.trim() === ${JSON.stringify(`${totalCount - 1}/${totalCount}`)} && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='扫一扫打卡'&&!b.disabled)`, 'four-of-five home before final point')
  await pointerClick({ call, evaluate }, '.scan-dock button:not([disabled])')
  await waitFor('window.__simulatedScan', 'final-point simulated scan hook')
  await evaluate(`window.__simulatedScan.success({ resultStr: ${JSON.stringify(`${origin}/q/${point.key}`)} })`)
  await waitFor(`document.querySelector('.point-detail')?.dataset.pointKey === ${JSON.stringify(point.key)} && document.querySelector('input[type=file]')`, 'final point upload view')

  const documentNode = await call('DOM.getDocument')
  const input = await call('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input[type=file]' })
  assert.ok(input.nodeId, 'real native file input exists for final point')
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [samplePath] })
  await waitFor('document.querySelector(".local-preview")?.naturalWidth > 0', 'final point local preview')
  await capture('last-point-selected')
  await waitFor(`${buttonExpression('提交现场照片')} && !${buttonExpression('提交现场照片')}.disabled`, 'final submit enabled')
  await evaluate(`${buttonExpression('提交现场照片')}.click()`)
  await waitFor(`document.querySelector('.point-count')?.textContent.trim() === ${JSON.stringify(`${totalCount}/${totalCount}`)} && document.querySelector('.success-next')?.textContent.trim()==='查看领取凭证'`, 'final point success')
  const state = await evaluate(`fetch('/api/me').then(r=>r.json()).then(r=>r.data)`)
  assert.equal(state.allCompleted, true)
  assert.equal(state.claimedAt, null)
  assert.equal(await evaluate('document.querySelector(".claim-panel") === null'), true, 'voucher is not stacked above the final-point success action')
  await capture('last-point-success')

  await pointerClick({ call, evaluate }, '.success-next')
  await waitFor('location.hash === "#claim" && document.querySelector(".claim-qr")?.naturalWidth > 0', 'owner voucher after final point')
  assert.equal(await evaluate('location.pathname'), '/')
  assert.equal(await evaluate('Boolean(document.querySelector(".staff-claim"))'), false)
  assert.equal(await evaluate(`Boolean(${buttonExpression('已完成奖品派发')})`), false)
  assert.equal(await evaluate('Boolean(document.querySelector(".claim-panel"))'), true)
  await capture('own-voucher-after-last')
}

export async function checkA4Pages({ call, evaluate, click, waitFor, capture, origin, cookie, credential, activity, progressCookie = cookie }) {
  const originalEnabled = activity.enabled
  const originalPoints = activity.points
  const setCookie = async (header = cookie) => {
    await call('Network.clearBrowserCookies')
    await call('Network.setCookie', { name: 'changqi.sid', value: header.slice('changqi.sid='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  }
  const normalUa = () => call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 A4-NORMAL-BROWSER-TEST' })
  const wechatUa = () => call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 A4-TEST MicroMessenger/8.0 (SIMULATED SDK, NOT A DEVICE)' })
  try {
    await call('Network.clearBrowserCookies')
    await normalUa()
    await call('Page.navigate', { url: origin })
    await waitFor('document.body.textContent.includes("请在微信内打开") && document.querySelector(".map-point")', 'normal browser home')
    assert.equal(await evaluate('Boolean(document.querySelector(".point-count"))'), false, 'No fake logged-out progress')
    assert.equal(await evaluate('document.querySelector(".point-disclosure").open'), false, 'duplicated list is collapsed by default')
    await capture('logged-out')

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
    assert.equal(await evaluate('document.querySelector(".guide-qr") === null'), true, 'no fake official-account QR')

    await setCookie(cookie)
    await wechatUa()
    await call('Page.navigate', { url: origin })
    await waitFor('document.querySelector(".point-count") && [...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="扫一扫打卡" && !b.disabled)', 'logged-in home')
    assert.equal(await evaluate('document.querySelector(".point-disclosure").open'), false)
    await capture('home')
    await pointerClick({ call, evaluate }, '.point-disclosure > summary')
    await waitFor('document.querySelector(".point-disclosure").open === true', 'expanded point list')
    assert.equal(await evaluate(`document.querySelectorAll('.point-button').length`), originalPoints.length)
    for (const point of originalPoints) {
      assert.equal(await evaluate(`document.querySelector('.point-button[data-point-key="${point.key}"] .point-art')?.getAttribute('src')`), point.image)
    }
    await capture('home-expanded')
    await pointerClick({ call, evaluate }, '.point-disclosure > summary')

    for (const point of originalPoints) {
      await pointerClick({ call, evaluate }, `.map-point[data-point-key="${point.key}"]`)
      await waitFor(`document.querySelector('.point-detail')?.dataset.pointKey === ${JSON.stringify(point.key)}`, `view ${point.key}`)
      const shown = await evaluate(`(() => { const art=document.querySelector('.art-detail'); return { key:art?.dataset.artKey, name:document.querySelector('.point-heading h2')?.textContent, image:art?.querySelector('img')?.getAttribute('src'), tip:document.querySelector('.photo-tip')?.textContent, input:Boolean(document.querySelector('input[type=file]')) } })()`)
      assert.equal(shown.key, point.key)
      assert.equal(shown.name, point.name)
      assert.equal(shown.image, point.image)
      assert.ok(shown.tip.includes(point.photoTip))
      assert.equal(shown.input, false, 'map/list viewing alone never grants upload eligibility')
      await capture(`point-${point.key}-view`)

      await waitFor(`[...document.querySelectorAll('.point-detail .scan-controls button')].some(b=>b.textContent.trim()==='扫一扫打卡' && !b.disabled)`, `scanner ready for ${point.key}`)
      await pointerClick({ call, evaluate }, '.point-detail .scan-controls button:not([disabled])')
      await waitFor('window.__simulatedScan', 'simulated scan hook')
      await evaluate(`window.__simulatedScan.success({ resultStr: ${JSON.stringify(`${origin}/q/${point.key}`)} })`)
      await waitFor(`document.querySelector('input[type=file]')?.id === ${JSON.stringify(`photo-${point.key}`)}`, `scan maps to ${point.key}`)
      assert.equal(await evaluate(`document.querySelector('.point-detail')?.dataset.pointKey`), point.key)
      assert.equal(await evaluate(`document.querySelector('.art-detail')?.dataset.artKey`), point.key)
      await capture(`point-${point.key}-scan-ready`)
      await pointerClick({ call, evaluate }, '.back-button')
      await waitFor('document.querySelector(".village-map") && !document.querySelector(".point-detail")', 'return to map')
    }

    // p03 -> p04 -> p05 must never reuse the old well art/state.
    for (const key of ['p03', 'p04', 'p05']) {
      await pointerClick({ call, evaluate }, `.map-point[data-point-key="${key}"]`)
      await waitFor(`document.querySelector('.art-detail')?.dataset.artKey === ${JSON.stringify(key)}`, `fresh art for ${key}`)
      const expected = originalPoints.find((point) => point.key === key)
      assert.equal(await evaluate(`document.querySelector('.art-detail img')?.getAttribute('src')`), expected.image)
      assert.equal(await evaluate('Boolean(document.querySelector(".local-preview"))'), false)
      await pointerClick({ call, evaluate }, '.back-button')
      await waitFor('document.querySelector(".village-map")', 'map after point switch')
    }

    // Reorder/add/remove points at runtime: N, fallback placement and completed state stay key-driven.
    await setCookie(progressCookie)
    activity.points = [
      { key: 'a4-added', name: '配置新增地点', image: null, imageAlt: '配置新增地点插画', photoTip: '测试新增地点拍照提示', displayOrder: 1 },
      ...[...originalPoints].reverse().map((point, index) => ({ ...point, displayOrder: index + 2 }))
    ]
    await call('Page.navigate', { url: origin })
    await waitFor(`document.querySelectorAll('.map-point').length === ${activity.points.length} && document.querySelector('.point-count')`, 'dynamic N=6')
    assert.equal(await evaluate('document.querySelector(".map-canvas").dataset.placement'), 'fallback')
    const completed = await evaluate(`[...document.querySelectorAll('.map-points li.completed .map-point')].map(button=>button.dataset.pointKey).sort()`)
    assert.deepEqual(completed, ['p01', 'p02'])
    assert.equal(await evaluate(`document.querySelector('.map-point[data-point-key="a4-added"]').closest('li').classList.contains('completed')`), false)
    assert.equal(await evaluate('document.querySelector(".point-disclosure").open'), false)
    await capture('configuration-reordered-n6')
    await pointerClick({ call, evaluate }, '.point-disclosure > summary')
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.point-status.done')].map(node=>node.closest('.point-button').dataset.pointKey).sort()`), ['p01', 'p02'])
    await capture('configuration-list-n6')

    activity.points = originalPoints.filter((point) => point.key !== 'p03').map((point, index) => ({ ...point, displayOrder: index + 1 }))
    await call('Page.navigate', { url: origin })
    await waitFor(`document.querySelectorAll('.map-point').length === 4 && document.querySelector('.point-count')?.textContent.trim().endsWith('/4')`, 'dynamic N=4')
    assert.equal(await evaluate(`document.querySelector('.map-point[data-point-key="p03"]') === null`), true)
    await capture('configuration-removed-n4')
    activity.points = originalPoints

    // Broken art must show a truthful unavailable state, never another landmark.
    await setCookie(cookie)
    activity.points = originalPoints
    await call('Page.reload')
    await waitFor(`document.querySelector('.map-point[data-point-key="p03"]')`, 'restored five-point config after N=4 test')
    await evaluate(`location.hash='point/p03'`)
    await waitFor('document.querySelector(".art-detail")', 'p03 artwork component rendered')
    const hadP03Image = await evaluate(`Boolean(document.querySelector('.art-detail img'))`)
    if (hadP03Image) await evaluate(`document.querySelector('.art-detail img').dispatchEvent(new Event('error'))`)
    await waitFor('document.querySelector(".art-detail .art-unavailable")', 'p03 artwork unavailable fallback')
    assert.equal(await evaluate('document.querySelector(".point-heading h2").textContent'), '沉香古井')
    assert.equal(await evaluate('document.querySelector(".art-detail img") === null'), true)
    await capture('point-art-unavailable')

    activity.enabled = false
    await call('Page.navigate', { url: origin })
    await waitFor('document.querySelector(".point-count") && document.body.textContent.includes("活动暂未开放或已结束")', 'closed activity still restores progress')
    const scanButton = await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='扫一扫打卡')?.disabled`)
    assert.equal(scanButton, true)
    await capture('activity-closed')
    activity.enabled = originalEnabled

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
    await setCookie(cookie)
    await wechatUa()
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
    await call('Network.setBlockedURLs', { urls: [] })
    await call('Network.setCacheDisabled', { cacheDisabled: false })
  }
}
