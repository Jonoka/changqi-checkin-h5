import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Actual Vue/HTTP/MySQL and native Chrome file input. Network faults/WeChat are explicitly simulated.
export async function checkPhotoReplacementBrowser({ call, evaluate, waitFor, capture, cookie, otherCookie, missingCookie, samplePath, pngPath, badPath, activity, origin, readUi, uiProgress, uiInvariant, imageDigest, changeUi, claimUi, holdUi }) {
  const n = activity.points.length, key = activity.points[0].key
  const card = `.voucher-photo-card[data-photo-point="${key}"]`
  const panel = `${card} .saved-photo-panel`
  const setCookie = value => call('Network.setCookie', { name: 'changqi.sid', value: value.slice('changqi.sid='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const photos = count => waitFor(`document.querySelectorAll('.voucher-photos img.saved-photo').length === ${count} && [...document.querySelectorAll('.voucher-photos img.saved-photo')].every(i => i.complete && i.naturalWidth > 0)`, 'saved owner photos loaded')
  const phase = value => waitFor(`document.querySelector(${JSON.stringify(panel)})?.dataset.phase === ${JSON.stringify(value)}`, `replacement phase ${value}`)
  const choose = async filename => {
    const document = await call('DOM.getDocument')
    const node = await call('DOM.querySelector', { nodeId: document.root.nodeId, selector: '.replacement-editor input[type=file]' })
    assert.ok(node.nodeId, 'Only the active inline replacement editor has a native picker')
    await call('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [filename] })
  }
  const locked = async () => {
    assert.equal(await evaluate('Boolean(document.querySelector(".claim-qr"))'), false, 'No presentable QR while editing/unknown')
    assert.equal(await evaluate('document.querySelector(".claim-action button")?.disabled'), true)
    assert.equal(await evaluate('document.querySelector(".back-button").disabled'), true)
  }
  const marks = () => evaluate(`Object.keys(sessionStorage).filter(k=>k.startsWith('changqi.photo-replacement:')).map(k=>JSON.parse(sessionStorage.getItem(k)))`)
  const shownDigest = () => evaluate(`(async()=>{const b=await (await fetch(document.querySelector('img.saved-photo').src)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(b=>b.toString(16).padStart(2,'0')).join('')})()`)
  await call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 PHOTO-TEST MicroMessenger/8.0 (SIMULATED SDK, NOT A DEVICE)' })
  await setCookie(cookie); await call('Page.navigate', { url: `${origin}/#claim` }); await photos(n)
  await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'owner QR after real photos')
  const initial = await uiInvariant(), initialProgress = await uiProgress()
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.voucher-photo-card')].map(card=>card.dataset.photoPoint)`), [...activity.points].sort((a,b)=>a.displayOrder-b.displayOrder).map(point=>point.key))
  assert.equal(await evaluate('document.querySelector(".voucher-photos").closest("details") === null'), true)
  assert.equal(await evaluate(`[...document.querySelectorAll('.voucher-photos img.saved-photo')].every(i => getComputedStyle(i).objectFit === 'contain' && Math.abs(i.getBoundingClientRect().width/i.getBoundingClientRect().height-i.naturalWidth/i.naturalHeight)<.02)`), true)
  assert.equal(await shownDigest(), await imageDigest())
  await capture('voucher-photos')
  await click(`${card} .view-photo`)
  await waitFor('document.querySelector("dialog[open] img")?.naturalWidth > 0', 'full saved image dialog')
  assert.equal(await evaluate('document.querySelector("dialog[open] img").src === document.querySelector("img.saved-photo").src'), true)
  assert.equal(await evaluate('document.querySelector("dialog[open] img").dataset.photoRevision === document.querySelector("img.saved-photo").dataset.photoRevision'), true)
  await click('dialog[open] .close-photo')

  const oldBlob = await evaluate('document.querySelector("img.saved-photo").src')
  await click(`${card} .change-photo`); await choose(pngPath)
  await waitFor('document.querySelector(".local-preview")?.naturalWidth > 0', 'distinct unsaved replacement preview')
  assert.equal(await evaluate('document.querySelector("img.saved-photo").src'), oldBlob)
  assert.equal(await evaluate('document.querySelectorAll(".replacement-editor").length'), 1)
  assert.equal(await evaluate('[...document.querySelectorAll(".change-photo")].every(b=>b.disabled)'), true)
  await locked(); await evaluate("location.hash='point/p02'")
  await waitFor("location.hash === '#claim' && document.querySelector('.replacement-editor')", 'editing blocks hash/back unmount')
  await capture('voucher-editing')
  await click('.cancel-replacement'); await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'cancel restores QR')
  assert.deepEqual(await uiInvariant(), initial); assert.equal((await marks()).length, 0)
  assert.equal((await readUi()).photos[0].revision, 'initial', 'Cancel did not save anything')

  await click(`${card} .change-photo`); await choose(badPath); await click('.confirm-replacement'); await phase('error')
  assert.match(await evaluate(`${JSON.stringify('')} + document.querySelector(${JSON.stringify(panel)}).textContent`), /未保存|无法|不支持|损坏/)
  assert.equal((await readUi()).photos[0].revision, 'initial')
  assert.deepEqual(await uiInvariant(), initial); assert.equal((await marks()).length, 0)
  assert.equal(await evaluate('document.querySelector(".cancel-replacement").disabled'), false)
  await capture('voucher-failed'); await click('.cancel-replacement')

  // A failed byte request is isolated to its card; the other saved photos are not illustrations/previews.
  await evaluate(`window.__photoRealFetch=window.fetch; window.fetch=async(...args)=>{if(String(args[0]).startsWith('/api/me/photos/${key}?')){return new Response(JSON.stringify({ok:false,error:{code:'TEST_PHOTO_NETWORK',message:'模拟照片读取失败，请重试'}}),{status:503,headers:{'content-type':'application/json'}})}return window.__photoRealFetch(...args)}`)
  await evaluate("window.dispatchEvent(new Event('pageshow'))")
  await waitFor(`document.querySelector(${JSON.stringify(panel)})?.textContent.includes('模拟照片读取失败')`, 'one photo load error')
  await photos(n - 1); await capture('voucher-photo-load-failed')
  await evaluate('window.fetch=window.__photoRealFetch')
  await evaluate(`[...document.querySelector(${JSON.stringify(panel)}).querySelectorAll('button')].find(b=>b.textContent.trim()==='重试读取照片').click()`)
  await photos(n)

  // Lost request + repeated metadata failures: old completed record must never imply success.
  await click(`${card} .change-photo`); await choose(pngPath)
  await evaluate(`window.__photoRealFetch=window.fetch;window.__photoAttempted=false;window.__replacementWrites=0;window.fetch=async(...args)=>{if(args[1]?.method==='PUT'){window.__replacementWrites++;window.__photoAttempted=true;throw new TypeError('SIMULATED upload network loss')}if(args[0]==='/api/me/photos'&&window.__photoAttempted)throw new TypeError('SIMULATED metadata loss');return window.__photoRealFetch(...args)}`)
  await click('.confirm-replacement'); await phase('unknown'); await locked()
  const [pending] = await marks(); assert.ok(pending); assert.equal(pending.expectedRevision, 'initial')
  for (let attempt = 0; attempt < 2; attempt++) { await click('.replacement-editor .verify-button'); await phase('unknown'); await locked() }
  assert.equal(await evaluate('window.__replacementWrites'), 1)
  assert.equal((await readUi()).photos[0].revision, 'initial'); assert.deepEqual(await uiInvariant(), initial)
  await capture('voucher-unknown')
  const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: "window.__photoRealFetch=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/me/photos')throw new TypeError('SIMULATED metadata loss after reload');return window.__photoRealFetch(...args)}" })
  await call('Page.reload'); await phase('unknown')
  await waitFor('document.body.textContent.includes("仍无法确认替换结果")', 'pending operation restored after reload')
  await locked(); assert.equal(await evaluate('Boolean(document.querySelector(".local-preview"))'), false)
  assert.deepEqual(await marks(), [pending], 'Reload retains ID/expected revision but no photo')
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
  await evaluate('window.fetch=window.__photoRealFetch')
  await click('.replacement-editor .verify-button'); await phase('unknown')
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent`), /服务器仍是旧版本/)
  await choose(samplePath); await click('.confirm-replacement'); await phase('unknown')
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent`), /不是本次修改的原文件/)
  await choose(pngPath); await click('.confirm-replacement'); await phase('success'); await photos(n)
  assert.equal((await readUi()).photos[0].revision, pending.replacementId)
  assert.equal(await shownDigest(), await imageDigest()); assert.deepEqual(await uiInvariant(), initial)
  assert.equal((await marks()).length, 0)
  await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'exact-ID recovery restores QR')
  await capture('voucher-replaced')

  // Another device changes this point after the editor opens: refresh current photo, never overwrite it.
  await click(`${card} .change-photo`); await choose(samplePath)
  const conflictingRevision = await changeUi()
  await click('.confirm-replacement'); await phase('conflict'); await locked()
  assert.equal((await readUi()).photos[0].revision, conflictingRevision)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(card + ' img.saved-photo')}).dataset.photoRevision`), conflictingRevision)
  await capture('voucher-conflict')
  await click('.acknowledge-photo')
  await waitFor('document.querySelector(".claim-qr")?.naturalWidth > 0', 'acknowledged version conflict restores QR')

  // A real request remains blocked at the users row; its lost response cannot be treated as failed.
  const release = await holdUi()
  try {
    await click(`${card} .change-photo`); await choose(samplePath)
    await evaluate(`window.__photoRealFetch=window.fetch;window.__detachedWrites=0;window.fetch=async(...args)=>{if(args[1]?.method==='PUT'){window.__detachedWrites++;window.__detachedPhoto=window.__photoRealFetch(...args);window.__detachedPhoto.catch(()=>{});throw new TypeError('SIMULATED response lost while real request is pending')}return window.__photoRealFetch(...args)}`)
    await click('.confirm-replacement'); await phase('unknown'); await locked()
    assert.equal((await readUi()).photos[0].revision, conflictingRevision, 'Actual pending request has not committed yet')
    await click('.replacement-editor .verify-button'); await phase('unknown')
    assert.equal(await evaluate('window.__detachedWrites'), 1)
    await capture('voucher-pending-commit')
  } finally { await release() }
  assert.equal(await evaluate('window.__detachedPhoto.then(response=>response.status)'), 200)
  await evaluate('window.fetch=window.__photoRealFetch')
  await click('.replacement-editor .verify-button'); await phase('success'); await photos(n)
  const committed = (await readUi()).photos[0].revision
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(card + ' img.saved-photo')}).dataset.photoRevision`), committed)
  assert.deepEqual(await uiInvariant(), initial)

  // Detail and full-size dialog must read the same revision/bytes as the voucher, no rescan required.
  await evaluate(`location.hash='point/${key}'`)
  await waitFor(`document.querySelector('.point-detail img.saved-photo')?.dataset.photoRevision === ${JSON.stringify(committed)}`, 'detail gets replaced revision without scan')
  assert.equal(await shownDigest(), await imageDigest())
  assert.equal(await evaluate('Boolean(document.querySelector(".change-photo"))'), true)
  await click('.view-photo'); assert.equal(await evaluate('document.querySelector("dialog[open] img").dataset.photoRevision'), committed); await click('dialog[open] .close-photo')

  // Hold an older byte response, change the photo elsewhere, and deliver the stale response last.
  await evaluate(`window.__photoRealFetch=window.fetch;window.__holdOnePhoto=true;window.fetch=async(...args)=>{const response=await window.__photoRealFetch(...args);if(String(args[0]).startsWith('/api/me/photos/${key}?')&&window.__holdOnePhoto){window.__holdOnePhoto=false;await new Promise(resolve=>window.__releaseLatePhoto=resolve)}return response};window.dispatchEvent(new Event('pageshow'))`)
  await waitFor('window.__releaseLatePhoto', 'older photo response held')
  const newer = await changeUi()
  await evaluate("window.dispatchEvent(new Event('pageshow'))")
  await waitFor(`document.querySelector('img.saved-photo')?.dataset.photoRevision === ${JSON.stringify(newer)}`, 'new photo wins over held older response')
  await evaluate('window.__releaseLatePhoto();window.fetch=window.__photoRealFetch'); await delay(120)
  assert.equal(await evaluate('document.querySelector("img.saved-photo").dataset.photoRevision'), newer)
  assert.equal(await shownDigest(), await imageDigest())

  // Account switches unmount the keyed old reader, invalidate delayed metadata and release old blobs.
  await evaluate(`window.__oldPhotoUrl=document.querySelector('img.saved-photo').src;window.__photoRealFetch=window.fetch;window.__holdMetadata=true;window.fetch=async(...args)=>{const response=await window.__photoRealFetch(...args);if(args[0]==='/api/me/photos'&&window.__holdMetadata){window.__holdMetadata=false;await new Promise(resolve=>window.__releaseLateMetadata=resolve)}return response};window.dispatchEvent(new Event('pageshow'))`)
  await waitFor('window.__releaseLateMetadata', 'old owner metadata held')
  await setCookie(otherCookie); await evaluate("window.dispatchEvent(new Event('pageshow'))")
  await waitFor('document.querySelector("img.saved-photo")?.dataset.photoRevision === "initial"', 'other user gets their own photo')
  await evaluate('window.__releaseLateMetadata();window.fetch=window.__photoRealFetch'); await delay(120)
  assert.equal(await shownDigest(), await imageDigest('other'))
  assert.equal(await evaluate('fetch(window.__oldPhotoUrl).then(()=>false,()=>true)'), true, 'Discarded old-owner blob URL revoked')

  // Non-five configuration and ordering are read from the single activity definition.
  const points = activity.points
  try {
    activity.points = [{ key: 'photo-added', name: '配置新增地点', displayOrder: 1, image: null }, ...[...points].reverse().map((point, index) => ({ ...point, displayOrder: index + 2 }))]
    // A hash-only navigation does not reload the fixed activity configuration. Force a new document.
    await setCookie(cookie); await call('Page.navigate', { url: `${origin}/?photoCase=dynamic#claim` })
    await waitFor(`document.querySelectorAll('.voucher-photo-card').length === ${n + 1}`, 'voucher dynamically renders N+1')
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.voucher-photo-card')].map(card=>card.dataset.photoPoint)`), activity.points.map(point=>point.key))
    await waitFor('document.querySelector(".voucher-photo-card").textContent.includes("尚无该地点")', 'new configured point has an honest missing-record message')
  } finally { activity.points = points }

  // A staff device can claim while this phone is selecting. Preflight/server prohibit a late change.
  await setCookie(cookie); await call('Page.navigate', { url: `${origin}/?photoCase=claim-race#claim` }); await photos(n)
  await click(`${card} .change-photo`); await choose(pngPath); await locked()
  assert.equal((await claimUi()).status, 200)
  await click('.confirm-replacement'); await phase('conflict')
  await waitFor('document.querySelector(".claimed-status")', 'external staff claim updates local readonly status')
  await click('.acknowledge-photo'); await photos(n)
  assert.equal(await evaluate('document.querySelectorAll(".change-photo").length'), 0)
  assert.equal(await evaluate('Boolean(document.querySelector(".claim-qr"))'), false)
  assert.equal((await readUi()).photos[0].revision, newer, 'No switch after claim')
  await capture('voucher-readonly')

  await setCookie(missingCookie); await call('Page.navigate', { url: `${origin}/?photoCase=missing#claim` }); await photos(n - 1)
  await waitFor('document.body.textContent.includes("照片已不可用")', 'honest missing-photo state')
  assert.equal(await evaluate('document.querySelector(".voucher-progress").textContent.includes("已完成全部地点")'), true)
  assert.equal(await evaluate(`${JSON.stringify('')} + document.querySelector(${JSON.stringify(card)}).querySelectorAll('img.saved-photo, img.local-preview, img[src^="/art/"]').length`), '0')
  await capture('voucher-missing')
  activity.enabled = false
  try {
    await call('Page.reload'); await photos(n - 1)
    await waitFor('document.body.textContent.includes("活动已结束")', 'closed activity retains readable photos')
    assert.equal(await evaluate('document.querySelectorAll(".change-photo").length'), 0)
    await capture('voucher-closed')
  } finally { activity.enabled = true }
  assert.equal(initialProgress.completedCount, n)
}
