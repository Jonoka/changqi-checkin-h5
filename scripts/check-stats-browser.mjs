import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomInt, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export async function checkStatsBrowser({ executable, directory, origin, credential }) {
  assert.ok(executable, 'Set TEST_BROWSER_EXECUTABLE to the existing local Chrome')
  const profile = path.join(directory, 'stats-chrome-profile'); await fs.mkdir(profile)
  let port
  for (let i = 0; i < 20; i++) {
    const probe = net.createServer(), candidate = randomInt(20000, 60000)
    try {
      await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(candidate, '127.0.0.1', resolve) })
      await new Promise(resolve => probe.close(resolve)); port = candidate; break
    } catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error }
  }
  assert.ok(port)
  const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  const pending = new Map(); let socket, id = 0, loadCount = 0
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id, timer = setTimeout(() => { pending.delete(current); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(current, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id: current, method, params }))
  })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.equal(result.exceptionDetails, undefined)
    return result.result.value
  }
  async function waitFor(check) {
    for (let i = 0; i < 120; i++) { if (await check()) return; await delay(50) }
    throw new Error('Stats browser condition timed out')
  }
  try {
    let endpoint
    await waitFor(async () => {
      assert.equal(browser.exitCode, null)
      try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })).json()).find(target => target.type === 'page')?.webSocketDebuggerUrl; return Boolean(endpoint) } catch { return false }
    })
    assert.ok(endpoint.startsWith(`ws://127.0.0.1:${port}/devtools/page/`))
    socket = new WebSocket(endpoint)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (message.method === 'Page.loadEventFired') loadCount++
      const command = pending.get(message.id)
      if (!command) return
      pending.delete(message.id)
      if (message.error) command.reject(new Error(message.error.message)); else command.resolve(message.result)
    })
    await call('Page.enable'); await call('Network.enable')
    await call('Network.setExtraHTTPHeaders', { headers: { Authorization: credential } })
    await call('Page.navigate', { url: `${origin}/stats` })
    await waitFor(() => evaluate('document.querySelectorAll(".stats-number").length === 4'))
    const snapshots = [], version = await call('Browser.getVersion')
    for (const width of [390, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 })
      await evaluate('document.fonts.ready.then(() => true)')
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `stats no horizontal overflow at ${width}`)
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".stats-number")].map(node => node.textContent)'), ['3', '2', '1', '1'])
      assert.equal(await evaluate("[...document.querySelectorAll('a')].filter(a => a.getAttribute('href')?.startsWith('/stats/export/')).length"), 3)
      const layout = await call('Page.getLayoutMetrics')
      const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(layout.cssContentSize.height), scale: 1 } })
      const bytes = Buffer.from(image.data, 'base64'), file = `stats-${width}.png`
      await fs.writeFile(path.join(directory, file), bytes)
      snapshots.push({ file, width, height: Math.ceil(layout.cssContentSize.height), sha256: createHash('sha256').update(bytes).digest('hex'), queriedAt: await evaluate('document.querySelector("time").textContent') })
    }
    const previousLoads = loadCount
    await evaluate('document.querySelector("form button").click()')
    await waitFor(async () => loadCount > previousLoads && await evaluate('document.querySelectorAll(".stats-number").length === 4'))
    assert.equal(await evaluate('document.querySelector("[data-stats-count]").textContent'), '1')
    await fs.writeFile(path.join(directory, 'stats-screenshots.json'), JSON.stringify({ synthetic: true, browser: version.product, snapshots, manualRefresh: true }, null, 2))
    await fs.writeFile(path.join(directory, 'stats-review.html'), `<!doctype html><meta charset="utf-8"><title>统计页合成数据本地复核</title><h1>隔离MySQL + 合成数据 + Chrome（不是真机）</h1>${snapshots.map(row => `<h2>${row.width}px</h2><img src="${row.file}" style="max-width:100%;border:1px solid #ccc">`).join('')}`)
    return { browser: version.product, snapshots }
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { await call('Browser.close').catch(() => {}); socket.close() }
    for (const command of pending.values()) command.reject(new Error('Test browser closed'))
    if (browser.exitCode === null && browser.signalCode === null) { const done = once(browser, 'exit'); browser.kill(); await done }
  }
}
