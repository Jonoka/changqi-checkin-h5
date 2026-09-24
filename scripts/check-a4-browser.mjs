import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const versionFiles = [
  'config/activity.json',
  'server/config.js',
  'server/a1.js',
  'server/app.js',
  'server/identity.js',
  'server/session.js',
  'server/wechat.js',
  'server/http.js',
  'server/checkins.js',
  'server/photo-replacement.js',
  'server/photos.js',
  'server/claims.js',
  'db/schema.sql',
  'db/migrations/001-photo-revision.mjs',
  'web/src/SavedPhoto.vue',
  'web/src/photo-replacement.js',
  'web/src/api.js',
  'web/src/App.vue',
  'web/src/VillageMap.vue',
  'web/src/PointArt.vue',
  'web/src/PhotoPanel.vue',
  'web/src/ClaimPanel.vue',
  'web/src/IdentityStatus.vue',
  'web/src/ScanControls.vue',
  'web/src/wechat-scan.js',
  'web/src/photo-upload.js',
  'web/src/style.css',
  'web/src/map-layout.js',
  'web/src/ClaimPage.vue',
  'web/src/ClaimAction.vue',
  'web/public/art/illustration-manifest.json',
  'assets/illustrations/restoration/masters/map-field-final-v1.png',
  'web/public/art/map-field-final-v1.webp',
  'web/public/art/point-p01-restored-v1.webp',
  'web/public/art/point-p02-restored-v1.webp',
  'web/public/art/point-p03-restored-v1.webp',
  'web/public/art/point-p04-restored-v1.webp',
  'web/public/art/point-p05-restored-v1.webp'
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
  const comparison = currentMap ? `<h2>最终现场地图 / 实际页面</h2><div class="comparison"><figure><a href="../../assets/illustrations/restoration/masters/map-field-final-v1.png"><img src="../../assets/illustrations/restoration/masters/map-field-final-v1.png" alt="用户最终确认的完整现场地图"></a><figcaption>最终 PNG 母版 · 页面不再叠加路线、点位或兑奖处</figcaption></figure><figure><a href="${escapeHtml(currentMap)}" target="_blank"><img src="${escapeHtml(currentMap)}" alt="本轮实际首页地图"></a><figcaption>本轮 390px 实际渲染地图</figcaption></figure></div>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A4 本地视觉复核</title><style>
body{margin:0;padding:24px;background:#f2f1e8;color:#254533;font:15px/1.65 system-ui,-apple-system,sans-serif}main{max-width:1280px;margin:auto}h1,h2{line-height:1.3}code{overflow-wrap:anywhere}.meta{padding:14px 18px;background:#fff;border:1px solid #d6ddce;border-radius:12px}.comparison,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px;align-items:start}.comparison{max-width:920px}.grid figure,.comparison figure{margin:0;padding:10px;background:#fff;border:1px solid #d6ddce;border-radius:12px}.grid img,.comparison img{display:block;width:100%;height:auto}figcaption{padding:9px 3px 2px}small{color:#667568}@media(max-width:600px){body{padding:12px}}
</style></head><body><main><h1>长岐村 A4 本地视觉复核</h1><p>截图来自隔离 MySQL + 本机 Chrome。微信 SDK、微信网络及故障注入为模拟，不是真机验收。</p><div class="meta">分支：<code>${escapeHtml(version.branch)}</code><br>截图基准 HEAD：<code>${escapeHtml(version.head)}</code><br>运行时源码/素材指纹：<code>${escapeHtml(version.runtimeSha256)}</code><br><a href="a4-screenshots.json">查看截图元数据</a></div>${comparison}<h2>实际页面状态</h2><div class="grid">${cards}</div></main></body></html>`
}

// Explicit evidence reuse suppresses image capture, never the live DOM/business assertions.
export async function reusableA4Evidence(directory, version) {
  const evidence = JSON.parse(await fs.readFile(path.join(directory, 'a4-screenshots.json'), 'utf8'))
  assert.equal(evidence.version?.runtimeSha256, version.runtimeSha256, 'A4 evidence fingerprint changed: capture affected pages instead of reusing old images')
  assert.deepEqual(evidence.version.files, version.files, 'A4 evidence must describe the same runtime source and artwork')
  assert.ok(evidence.screenshots?.length > 0, 'A4 evidence contains no screenshots')
  const files = new Set(evidence.screenshots.flatMap(row => [row.file, row.mapFile, row.viewportFile]).filter(Boolean))
  for (const file of files) {
    assert.match(file, /^a4-[a-z0-9-]+\.png$/, 'Only local A4 screenshot filenames may be reused')
    assert.ok((await fs.stat(path.join(directory, file))).size > 0, 'Referenced A4 screenshot is missing or empty')
  }
  return { directory: path.relative(process.cwd(), directory), runtimeSha256: version.runtimeSha256, screenshotCount: evidence.screenshots.length, imageFileCount: files.size }
}

// Optional exact state@width capture selection: assertions still run for every state/width.
export function a4CaptureRequested(name, width, selection) {
  if (!selection) return true
  const targets = selection.split(',')
  assert.ok(targets.every(target => /^[a-z0-9-]+@(320|390|430)$/.test(target)), 'Invalid A4 screenshot selection')
  return targets.includes(`${name}@${width}`)
}

// Uses the existing Chrome CDP connection and the same isolated MySQL application.
// These are real rendered Vue/HTTP/SQL states. WeChat SDK/network failures remain explicitly simulated.
export function createA4Capture({ call, evaluate, directory }) {
  const records = []
  const checkedStates = new Map()
  const versionPromise = runtimeVersion()
  let reusePromise
  return async function capture(name) {
    assert.match(name, /^[a-z0-9-]+$/)
    const version = await versionPromise
    const reuse = process.env.TEST_A4_REUSE_EVIDENCE
      ? await (reusePromise ??= reusableA4Evidence(path.resolve(process.env.TEST_A4_REUSE_EVIDENCE), version)) : null
    assert.ok(!(reuse && process.env.TEST_A4_CAPTURE), 'Choose old evidence reuse OR fresh selected screenshots, not both')
    for (const width of [320, 390, 430]) {
      const takeScreenshot = !reuse && a4CaptureRequested(name, width, process.env.TEST_A4_CAPTURE)
      const homeAction = ['home', 'all-completed', 'home-claimed'].includes(name)
      const viewportHeight = homeAction ? 568 : width === 320 ? 740 : 844
      await call('Emulation.setDeviceMetricsOverride', { width, height: viewportHeight, deviceScaleFactor: 1, mobile: true })
      await evaluate('window.scrollTo(0, 0)')
      // Folded-list images are intentionally lazy; require pixels only when their section is visible.
      // Expanded-list captures still require every configured thumbnail to decode successfully.
      await evaluate(`[...document.querySelectorAll('img[loading="lazy"]')].filter(image => image.checkVisibility()).forEach(image => image.loading = 'eager')`)
      await evaluate(`document.fonts.ready.then(() => Promise.all([...document.images].filter(image => image.checkVisibility()).map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.addEventListener('load', resolve, {once:true}); image.addEventListener('error', resolve, {once:true}); setTimeout(resolve, 5000) }))))`)
      assert.equal(await evaluate('document.documentElement.scrollWidth'), width, `${name}: no horizontal overflow at ${width}px`)
      if (await evaluate('Boolean(document.querySelector(".village-map, .point-detail"))')) {
        assert.doesNotMatch(await evaluate('document.body.innerText'), /CQ\d+/, `${name}: visitor number is absent from home and all point states`)
      }
      if (await evaluate('Boolean(document.querySelector(".point-detail .success-card"))')) {
        assert.match(await evaluate('document.querySelector(".scan-notice").textContent'), /本站已完成/, `${name}: completed point never requests another scan`)
      }
      assert.doesNotMatch(await evaluate('document.body.innerText'), /本人|扫一扫已就绪|选择现场照片|拍照提示/, `${name}: compact visitor-facing copy`)
      assert.equal(await evaluate('Boolean(document.querySelector(".photo-tip"))'), false, `${name}: no photography-tip block`)
      const headingStyle = await evaluate(`(() => { const h=document.querySelector('.point-heading h2'); if(!h) return null; const s=getComputedStyle(h); return { borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth], outline:s.outlineStyle }; })()`)
      if (headingStyle) {
        assert.deepEqual(headingStyle.borders, ['0px', '0px', '0px', '0px'], `${name}: title has no border`)
        assert.equal(headingStyle.outline, 'none', `${name}: programmatic heading focus has no box`)
      }
      const uploadLabel = await evaluate(`document.querySelector('.photo-picker:not(.has-selection) .upload-label strong')?.textContent ?? null`)
      if (uploadLabel !== null) assert.equal(uploadLabel, '上传现场照片')
      const claimTitle = await evaluate(`document.querySelector('#claim-title')?.textContent ?? null`)
      if (claimTitle !== null) assert.equal(claimTitle, '领取凭证')
      if (name === 'guide') {
        assert.equal(await evaluate('document.querySelector("h1").textContent'), '参与方式')
        assert.equal(await evaluate('document.title'), '参与方式')
        assert.equal(await evaluate('document.querySelector(".guide-qr") === null'), true, 'guide has no placeholder QR')
      }
      let firstScreenScan = null
      let viewportFile = null
      if (homeAction) {
        firstScreenScan = await evaluate(`(() => { const b=document.querySelector('.reward-next button') || [...document.querySelectorAll('.scan-controls button')].find(b=>b.textContent.trim()==='扫一扫打卡'); const r=b.getBoundingClientRect(); const m=document.querySelector('.village-map').getBoundingClientRect(); return { label:b.textContent.trim(),top:r.top,bottom:r.bottom,mapTop:m.top,viewportHeight:innerHeight,uncovered:b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)) }; })()`)
        assert.ok(firstScreenScan.top >= 0 && firstScreenScan.bottom <= firstScreenScan.viewportHeight, `${name}: primary action fully visible at ${width}x${viewportHeight}: ${JSON.stringify(firstScreenScan)}`)
        assert.ok(firstScreenScan.bottom <= firstScreenScan.mapTop, `${name}: primary action above the map`)
        assert.equal(firstScreenScan.uncovered, true, `${name}: first-screen primary action is not covered`)
        if (takeScreenshot) {
          const firstScreen = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
          viewportFile = `a4-${name}-first-screen-${width}.png`
          await fs.writeFile(path.join(directory, viewportFile), Buffer.from(firstScreen.data, 'base64'))
        }
      }
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('img[src^="/art/"], img.claim-qr, img.saved-photo')].filter(image => image.checkVisibility() && (!image.complete || image.naturalWidth === 0)).map(image => image.className)`), [], `${name}: required artwork/QR/saved images loaded`)
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('button:not(.map-point)')].filter(button => button.getClientRects().length && button.getBoundingClientRect().height < 43).map(button => button.textContent.trim())`), [], `${name}: primary/list buttons have touch-sized targets; transparent map hotspots are checked separately`)

      const alignment = await evaluate(`(() => {
        const canvas=document.querySelector('.map-canvas'); if(!canvas) return [];
        const image=canvas.querySelector('.map-scenery'), bad=[];
        if(!image || !image.naturalWidth) return ['missing-map-image'];
        const s=image.getBoundingClientRect(), c=canvas.getBoundingClientRect();
        if(image.getAttribute('src')!=='/art/map-field-final-v1.webp') bad.push('wrong-map-image');
        if(canvas.querySelector('.point-art')) bad.push('duplicate-landmark');
        if(canvas.querySelector('.map-route-overlay,.map-route-underlay,.map-route-line,.claim-map-marker,.claim-map-gift,.map-pin')) bad.push('duplicate-map-visual');
        if(Math.abs(s.width/s.height-image.naturalWidth/image.naturalHeight)>.002) bad.push('image-stretched');
        if(Math.abs(c.width-s.width)>1 || Math.abs(c.height-s.height)>1 || Math.abs(c.left-s.left)>1 || Math.abs(c.top-s.top)>1) bad.push('image-container-mismatch');
        const buttons=[...canvas.querySelectorAll('.map-point')];
        for(const button of buttons){
          const r=button.getBoundingClientRect();
          const style=getComputedStyle(button);
          const x=s.left+Number(button.dataset.mapX)/100*s.width;
          const y=s.top+Number(button.dataset.mapY)/100*s.height;
          if(Math.abs((r.left+r.width/2)-x)>1.5 || Math.abs((r.top+r.height/2)-y)>1.5) bad.push(button.dataset.pointKey+'-alignment');
          if(r.width<36 || r.width>44 || r.height<36 || r.height>44) bad.push(button.dataset.pointKey+'-target-size');
          if(button.textContent.trim() || style.backgroundColor!=='rgba(0, 0, 0, 0)' || style.borderTopWidth!=='0px' || style.boxShadow!=='none') bad.push(button.dataset.pointKey+'-visible');
          if(!button.title || !button.getAttribute('aria-label')) bad.push(button.dataset.pointKey+'-accessible-name');
          for(const other of buttons){
            if(other===button) continue;
            const o=other.getBoundingClientRect();
            if(Math.min(r.right,o.right)-Math.max(r.left,o.left)>1 && Math.min(r.bottom,o.bottom)-Math.max(r.top,o.top)>1) bad.push(button.dataset.pointKey+'-overlap');
          }
        }
        return bad;
      })()`)
      assert.deepEqual(alignment, [], `${name}: raster image and distinct HTML hotspots share undistorted coordinates at ${width}px`)

      const detailGeometry = await evaluate(`(() => {
        const image=document.querySelector('.art-detail img'); if(!image) return null;
        const r=image.getBoundingClientRect(), picker=document.querySelector('.photo-picker:not(.has-selection) .upload-label');
        const p=picker?.getBoundingClientRect();
        return { ratio:r.width/r.height, naturalRatio:image.naturalWidth/image.naturalHeight, pickerBottom:p?.bottom ?? null, height:innerHeight };
      })()`)
      if (detailGeometry) {
        assert.ok(Math.abs(detailGeometry.ratio - detailGeometry.naturalRatio) < .002, `${name}: detail artwork preserves its native aspect`)
        if (name.startsWith('point-') && name.endsWith('-scan-ready')) {
          assert.ok(detailGeometry.pickerBottom !== null && detailGeometry.pickerBottom <= detailGeometry.height, `${name}: upload selection stays visible without deep scrolling: ${JSON.stringify(detailGeometry)}`)
        }
      }

      checkedStates.set(`${name}-${width}`, { state: name, width, viewportHeight, firstScreenAction: firstScreenScan, checkedAt: new Date().toISOString(), captured: takeScreenshot })
      if (!takeScreenshot) continue

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

      // A state can be revisited; keep metadata aligned with the actual latest file.
      const previous = records.findIndex(record => record.file === filename)
      if (previous !== -1) records.splice(previous, 1)
      records.push({ state: name, width, height: Math.ceil(size.height), file: filename, mapFile, viewportFile, viewportHeight, firstScreenScan, capturedAt: new Date().toISOString(), mapAlignmentErrors: alignment })
    }
    if (reuse) {
      await fs.writeFile(path.join(directory, 'a4-regression.json'), JSON.stringify({
        environment: 'Actual Chrome + isolated MySQL; WeChat simulated; no new A4 screenshots or real-device claim',
        version, reusedVisualEvidence: reuse, checkedStates: [...checkedStates.values()]
      }, null, 2))
      return
    }
    await fs.writeFile(path.join(directory, 'a4-regression.json'), JSON.stringify({
      environment: 'Actual Chrome + isolated MySQL; WeChat simulated; fresh selected screenshots, no evidence reuse',
      version, checkedStates: [...checkedStates.values()], screenshotSelection: process.env.TEST_A4_CAPTURE || 'all', screenshotCount: records.length
    }, null, 2))
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
  await waitFor(`document.querySelectorAll('.voucher-photos img.saved-photo').length === ${totalCount} && [...document.querySelectorAll('.voucher-photos img.saved-photo')].every(image => image.naturalWidth > 0)`, 'all saved photos on owner voucher after final point')
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

    await wechatUa()
    await setCookie(cookie)
    const identityInjection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__a4Fetch=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/me'){const response=await window.__a4Fetch(...args);await new Promise(resolve=>window.__a4Resume=resolve);throw new TypeError('SIMULATED identity read failure')}return window.__a4Fetch(...args)}` })
    await call('Page.navigate', { url: origin })
    await waitFor('window.__a4Resume && document.body.textContent.includes("正在读取漫游记录")', 'identity loading')
    assert.equal(await evaluate('document.querySelectorAll(".identity-block button").length'), 0, 'loading has no login/retry buttons')
    assert.doesNotMatch(await evaluate('document.querySelector(".identity-block").innerText'), /失败|失效|重试|登录后/, 'loading is exclusive')
    await capture('identity-loading')
    await evaluate('window.__a4Resume()')
    await waitFor('document.body.textContent.includes("网络暂时不可用")', 'identity read failure')
    assert.equal(await evaluate('Boolean(document.querySelector(".point-count"))'), false)
    await capture('identity-error')
    await evaluate('window.fetch=window.__a4Fetch')
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: identityInjection.identifier })
    await click('重试读取身份')
    await waitFor('document.querySelector(".point-count")', 'manual identity retry restores the real session')
    await normalUa()
    // Changing the simulated UA needs a new document, not a same-document hash navigation.
    await call('Page.navigate', { url: `${origin}/?external-entry-test=1#point/p03` })
    await waitFor('document.body.textContent.includes("可先浏览地图")', 'outside WeChat ignores an old authenticated cookie')
    assert.equal(await evaluate('Boolean(document.querySelector("input[type=file], .point-count, .saved-photo"))'), false)
    await capture('outside-point')

    await call('Network.clearBrowserCookies')
    for (const [url, text, label] of [[`${origin}/q/p01`, '印象芦苞', 'guide'], [`${origin}/q/invalid`, '地点不存在', 'guide-invalid'], [`${origin}/auth/callback?state=bad`, '身份识别未完成', 'auth-error']]) {
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
    await evaluate(`window.__uiFetch=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/me')throw new TypeError('SIMULATED signed-in identity refresh failure');return window.__uiFetch(...args)}`)
    await click('刷新状态')
    await waitFor('document.querySelector(".identity-block [role=alert]")', 'signed-in refresh failure remains visible')
    assert.equal(await evaluate('Boolean(document.querySelector(".point-count"))'), false)
    await evaluate('window.fetch=window.__uiFetch')
    await click('重试读取身份')
    await waitFor('document.querySelector(".point-count")', 'manual retry recovers actual signed-in progress')
    assert.equal(await evaluate('Boolean(document.querySelector(".identity-block [role=alert]"))'), false)
    await pointerClick({ call, evaluate }, '.point-disclosure > summary')
    await waitFor('document.querySelector(".point-disclosure").open === true', 'expanded point list')
    assert.equal(await evaluate(`document.querySelectorAll('.point-button').length`), originalPoints.length)
    for (const point of originalPoints) {
      assert.equal(await evaluate(`document.querySelector('.point-button[data-point-key="${point.key}"] .point-art')?.getAttribute('src')`), point.image)
    }
    await capture('home-expanded')
    await pointerClick({ call, evaluate }, '.point-disclosure > summary')

    // Actual pointer hit tests for every configured map AND list entry at all target widths.
    const restoredEligibility = await evaluate(`fetch('/api/me').then(r=>r.json()).then(r=>r.data.scannedPointKey)`)
    for (const width of [320, 390, 430]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      for (const kind of ['map-point', 'point-button']) for (const point of originalPoints) {
        if (kind === 'point-button') await evaluate(`document.querySelector('.point-disclosure').open = true`)
        await pointerClick({ call, evaluate }, `.${kind}[data-point-key="${point.key}"]`)
        await waitFor(`document.querySelector('.point-detail')?.dataset.pointKey === ${JSON.stringify(point.key)}`, `${width}px ${kind} routes to ${point.key}`)
        assert.equal(await evaluate(`document.querySelector('.art-detail img')?.getAttribute('src')`), point.image)
        assert.equal(await evaluate(`document.querySelector('.point-heading h2')?.textContent`), point.name)
        assert.equal(await evaluate(`Boolean(document.querySelector('input[type=file]'))`), point.key === restoredEligibility, 'Viewing only retains the server-restored point; never grants a different point')
        if (kind === 'map-point') assert.equal(await evaluate(`fetch('/api/me').then(r=>r.json()).then(r=>r.data.scannedPointKey)`), restoredEligibility, 'Map hotspot does not change scannedPointKey')
        await pointerClick({ call, evaluate }, '.back-button')
        await waitFor(`Boolean(document.querySelector('.village-map'))`, 'return after actual pointer click')
      }
      await evaluate(`document.querySelector('.point-disclosure').open = false`)
    }

    for (const point of originalPoints) {
      await pointerClick({ call, evaluate }, `.map-point[data-point-key="${point.key}"]`)
      await waitFor(`document.querySelector('.point-detail')?.dataset.pointKey === ${JSON.stringify(point.key)}`, `view ${point.key}`)
      const shown = await evaluate(`(() => { const art=document.querySelector('.art-detail'); return { key:art?.dataset.artKey, name:document.querySelector('.point-heading h2')?.textContent, image:art?.querySelector('img')?.getAttribute('src'), tip:Boolean(document.querySelector('.photo-tip')), input:Boolean(document.querySelector('input[type=file]')) } })()`)
      assert.equal(shown.key, point.key)
      assert.equal(shown.name, point.name)
      assert.equal(shown.image, point.image)
      assert.equal(shown.tip, false, 'photography tips are not rendered')
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
      await pointerClick({ call, evaluate }, `.map-point[data-point-key="${point.key}"]`)
      await waitFor(`document.querySelector('input[type=file]')?.id === ${JSON.stringify(`photo-${point.key}`)}`, 'same scanned point keeps its available upload action')
      assert.match(await evaluate('document.querySelector(".scan-notice").textContent'), /请上传本站的现场照片/)
      await pointerClick({ call, evaluate }, '.back-button')
      await waitFor('document.querySelector(".village-map")', 'map after revisiting scanned point')
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

    // Reorder/add/remove: N stays dynamic; new unanchored locations use the folded list, never a fake landmark.
    await setCookie(progressCookie)
    activity.points = [
      { key: 'a4-added', name: '配置新增地点', image: null, imageAlt: '配置新增地点插画', photoTip: '测试新增地点拍照提示', displayOrder: 1 },
      ...[...originalPoints].reverse().map((point, index) => ({ ...point, displayOrder: index + 2 }))
    ]
    await call('Page.navigate', { url: origin })
    await waitFor(`document.querySelectorAll('.map-point').length === ${originalPoints.length} && document.querySelector('.point-count')?.textContent.trim().endsWith('/6')`, 'dynamic N=6, only existing anchors')
    assert.equal(await evaluate('document.querySelector(".map-canvas").dataset.placement'), 'final-map')
    for (const point of originalPoints) {
      assert.deepEqual(await evaluate(`(() => { const b=document.querySelector('.map-point[data-point-key="${point.key}"]'); return {x:Number(b.dataset.mapX),y:Number(b.dataset.mapY)} })()`), point.mapPosition)
    }
    assert.equal(await evaluate(`Boolean(document.querySelector('.map-point[data-point-key="a4-added"]'))`), false, 'No invented anchor for the added location')
    assert.equal(await evaluate('document.querySelector(".point-disclosure").open'), false)
    await capture('configuration-reordered-n6')
    await pointerClick({ call, evaluate }, '.point-disclosure > summary')
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.point-status.done')].map(node=>node.closest('.point-button').dataset.pointKey).sort()`), ['p01', 'p02'])
    await capture('configuration-list-n6')
    await pointerClick({ call, evaluate }, '.point-button[data-point-key="a4-added"]')
    await waitFor(`document.querySelector('.point-detail')?.dataset.pointKey === 'a4-added'`, 'unanchored location remains accessible through the list')
    assert.equal(await evaluate(`Boolean(document.querySelector('.art-detail img, input[type=file]'))`), false, 'No incorrect image or upload eligibility for the unanchored point')

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
