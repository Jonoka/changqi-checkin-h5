import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

// Reuses the existing installed-Chrome CDP check; no second browser test framework.
export async function checkA2Browser({ call, evaluate, click, waitFor, ready, cookie, otherCookie, samplePath, pngPath, badPath, directory, origin, totalCount, checkBrowserSaved }) {
  const setCookie = (value) => call('Network.setCookie', { name: 'changqi.sid', value: value.slice('changqi.sid='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
  const chooseFile = async (filename) => {
    const document = await call('DOM.getDocument')
    const node = await call('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type=file]' })
    assert.ok(node.nodeId, 'Native file input must exist only after scanning')
    await call('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [filename] })
  }
  const progress = () => evaluate('document.querySelector(".point-count")?.textContent.trim()')
  const scan = async (key) => {
    await ready(); await click('扫一扫打卡')
    await evaluate(`window.__simulatedScan.success({ resultStr: ${JSON.stringify(`${origin}/q/${key}`)} })`)
    await waitFor('document.querySelector("input[type=file]")', 'photo selection after scan')
    await ready()
  }
  await setCookie(cookie)
  await call('Page.navigate', { url: origin })
  await ready()
  assert.equal(await progress(), `0/${totalCount}`)
  await evaluate('document.querySelector(".point-button").click()')
  await waitFor('document.querySelector(".photo-panel")', 'view-only photo panel')
  assert.equal(await evaluate('Boolean(document.querySelector("input[type=file]"))'), false)
  await scan('p01')
  await chooseFile(samplePath)
  await waitFor('document.querySelector(".local-preview")?.naturalWidth > 0', 'real selected photograph preview')
  await chooseFile(pngPath)
  await waitFor('document.body.textContent.includes("second.png")', 'reselect another native file')
  await chooseFile(samplePath)
  await call('Page.reload')
  await ready()
  assert.match(await evaluate('document.body.textContent'), /重新选择/)
  assert.equal(await evaluate('Boolean(document.querySelector(".local-preview"))'), false)
  assert.equal(await progress(), `0/${totalCount}`)
  await scan('p01'); await chooseFile(samplePath)
  // Both requests fail before reaching the server: a second failed verification must keep retry locked.
  await evaluate(`window.__a2OriginalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (url === '/api/checkins' || url === '/api/me') throw new TypeError('SIMULATED network failure');
      return window.__a2OriginalFetch(...args);
    }`)
  await click('提交现场照片')
  await waitFor('document.body.textContent.includes("暂时无法确认是否保存")', 'unknown save result')
  assert.equal(await evaluate('Boolean([...document.querySelectorAll("button")].find(b => b.textContent.trim() === "核对保存结果"))'), true)
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "提交现场照片").disabled'), true)
  assert.equal(await progress(), `0/${totalCount}`)
  await click('核对保存结果')
  await waitFor('document.body.textContent.includes("仍无法确认保存结果")', 'failed save-result verification')
  assert.equal(await evaluate('Boolean([...document.querySelectorAll("button")].find(b => b.textContent.trim() === "核对保存结果"))'), true)
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "提交现场照片").disabled'), true)
  assert.equal(await progress(), `0/${totalCount}`)
  assert.equal(await evaluate('document.body.textContent.includes("照片保存成功")'), false)
  await evaluate('window.fetch = window.__a2OriginalFetch')
  await click('核对保存结果')
  await waitFor('document.body.textContent.includes("服务器尚无该地点记录")', 'confirmed unsaved result')
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "提交现场照片").disabled'), false)
  assert.equal(await progress(), `0/${totalCount}`)

  // Delay only the response delivery after the real request has saved, to inspect submit locking.
  await evaluate(`window.__a2OriginalFetch = window.fetch; window.__a2Uploads = 0;
    window.fetch = async (...args) => {
      if (args[0] === '/api/checkins') { window.__a2Uploads++; const result = await window.__a2OriginalFetch(...args); await new Promise(resolve => window.__a2Release = resolve); return result; }
      return window.__a2OriginalFetch(...args);
    }`)
  await click('提交现场照片')
  await waitFor('window.__a2Release', 'real upload saved but response held')
  assert.equal(await evaluate('document.querySelector("input[type=file]").disabled'), true)
  assert.equal(await progress(), `0/${totalCount}`, 'No optimistic progress before acknowledged save')
  await click('正在保存…')
  assert.equal(await evaluate('window.__a2Uploads'), 1)
  await evaluate('window.__a2Release(); window.fetch = window.__a2OriginalFetch')
  await waitFor('document.querySelector(".saved-photo")?.naturalWidth > 0', 'saved private photograph')
  assert.equal(await progress(), `1/${totalCount}`)
  await checkBrowserSaved(['p01'])
  assert.equal(await evaluate('Boolean(document.querySelector("input[type=file]"))'), false)

  await scan('p02'); await chooseFile(badPath); await click('提交现场照片')
  await waitFor('document.body.textContent.includes("照片无法解码")', 'unsupported file feedback')
  assert.equal(await progress(), `1/${totalCount}`)
  await chooseFile(pngPath)
  // Simulate a lost response AFTER a real SQL/file save, not a fake successful upload.
  await evaluate(`window.fetch = async (...args) => {
    const response = await window.__a2OriginalFetch(...args);
    if (args[0] === '/api/checkins') throw new TypeError('SIMULATED response loss after actual save');
    return response;
  }`)
  await click('提交现场照片')
  await waitFor('document.body.textContent.includes("已从服务器确认保存成功")', 'query-after-response-loss recovery')
  await evaluate('window.fetch = window.__a2OriginalFetch')
  await waitFor('document.querySelector(".saved-photo")?.naturalWidth > 0', 'recovered saved photograph')
  assert.equal(await progress(), `2/${totalCount}`)
  await checkBrowserSaved(['p01', 'p02'])
  await call('Page.reload'); await ready()
  await waitFor('document.querySelector(".saved-photo")?.naturalWidth > 0', 'saved photo restored after reload')
  assert.equal(await progress(), `2/${totalCount}`)
  for (const width of [390, 430]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `A2 page fits ${width}px`)
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await fs.writeFile(path.join(directory, `a2-browser-${width}.png`), Buffer.from(screenshot.data, 'base64'))
  }
  await setCookie(otherCookie)
  await call('Page.reload'); await ready()
  assert.equal(await progress(), `1/${totalCount}`)
  assert.equal(await evaluate('Boolean(document.querySelector(".saved-photo"))'), false, 'A different visitor must not see the former visitor photo')
  await evaluate(`window.location.hash = 'point/p01'`)
  await waitFor('document.body.textContent.includes("照片已不可用")', 'missing-photo message leaves history intact')
  assert.equal(await progress(), `1/${totalCount}`)
}
