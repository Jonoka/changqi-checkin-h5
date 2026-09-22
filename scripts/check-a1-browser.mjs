import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createA4Capture, pointerClick } from './check-a4-browser.mjs'

// Optional lightweight check with an already installed Chromium browser; no test framework/dependency.
// Native WeChat SDK callbacks below are explicitly SIMULATED. SQL/HTTP/Vue rendering remain real.
export async function checkA1Browser({ executable, directory, origin, cookie, totalCount, afterView, afterScan, afterA1, visual = false }) {
  const expectedProgress = `0/${totalCount}`
  const profile = path.join(directory, 'browser-profile')
  await fs.mkdir(profile, { recursive: true })
  const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  let socket
  let nextId = 0
  let sessionId
  const pending = new Map()
  const call = (method, params = {}, target = sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)) }, 10000)
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }))
  })
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.equal(result.exceptionDetails, undefined, 'Browser JavaScript must not throw')
    return result.result.value
  }
  const buttonExpression = (label) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`
  async function waitFor(expression, label) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`Boolean(${expression})`)) return
      await delay(50)
    }
    throw new Error(`Browser state did not recover: ${label}`)
  }
  const click = (label) => evaluate(`${buttonExpression(label)}.click()`)
  const capture = visual ? createA4Capture({ call, evaluate, directory }) : async () => {}
  const ready = () => waitFor(`${buttonExpression('扫一扫打卡')} && !${buttonExpression('扫一扫打卡')}.disabled`, 'scan ready')
  try {
    let portData
    for (let attempt = 0; attempt < 100; attempt++) {
      try { portData = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await delay(50) }
      assert.equal(browser.exitCode, null, 'Installed browser exited before remote debugging was ready')
    }
    assert.ok(portData, 'No debugging endpoint from the dedicated test browser')
    const [port, endpoint] = portData.trim().split(/\r?\n/)
    socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`)
    await once(socket, 'open')
    socket.addEventListener('message', ({ data }) => {
      const response = JSON.parse(data)
      const current = pending.get(response.id)
      if (!current) return
      pending.delete(response.id)
      if (response.error) current.reject(new Error(response.error.message))
      else current.resolve(response.result)
    })
    const target = await call('Target.createTarget', { url: 'about:blank' }, null)
    sessionId = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId
    await call('Page.enable')
    await call('Network.enable')
    await call('Network.setBlockedURLs', { urls: ['*://open.weixin.qq.com/*', '*://api.weixin.qq.com/*', '*://res.wx.qq.com/*'] })
    await call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 A1-TEST MicroMessenger/8.0 (SIMULATED SDK, NOT A DEVICE)' })
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.wx = {
        config() {},
        ready(callback) { setTimeout(callback, 30) },
        error(callback) { window.__simulatedSdkError = callback },
        scanQRCode(options) { window.__simulatedScan = options }
      };
      document.addEventListener('DOMContentLoaded', () => {
        const marker = document.createElement('p'); marker.textContent = '浏览器测试：模拟微信 SDK，不是真机';
        marker.setAttribute('data-test-marker', 'simulated-wechat'); document.body.prepend(marker);
      });
    ` })
    await call('Network.setCookie', { name: 'changqi.sid', value: cookie.slice('changqi.sid='.length), url: origin, httpOnly: true, sameSite: 'Lax' })
    await call('Page.navigate', { url: origin })
    await ready()
    assert.equal(await evaluate(`document.querySelector('.point-count').textContent.trim()`), expectedProgress)
    assert.match(await evaluate('document.body.textContent'), /模拟微信 SDK/)
    assert.equal(await evaluate('document.querySelector(".point-disclosure").open'), false, 'location list is collapsed by default')
    await capture('home')
    if (visual) {
      await pointerClick({ call, evaluate }, '.map-point[aria-label^="查看卢氏大宗祠"]')
      await waitFor('document.querySelector(".point-detail")', 'pointer map navigation')
      await waitFor('document.activeElement === document.querySelector(".point-heading h2")', 'route heading receives focus')
      assert.equal(await evaluate('document.activeElement.getBoundingClientRect().top < innerHeight'), true)
      await afterView()
      assert.equal(await evaluate('Boolean(document.querySelector("input[type=file]"))'), false)
      await pointerClick({ call, evaluate }, '.back-button')
      await waitFor('document.querySelector(".map-point")', 'return to schematic map')
    }
    for (const width of [320, 390, 430]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `No horizontal overflow at ${width}px`)
    }
    await pointerClick({ call, evaluate }, '.map-point[data-point-key="p02"]')
    await waitFor('document.querySelector(".point-detail")', 'point viewing')
    await afterView()
    assert.match(await evaluate('document.body.textContent'), /仅查看地点/)
    assert.match(await evaluate('document.body.textContent'), /请先使用页面内扫一扫/)
    assert.equal(await evaluate('Boolean(document.querySelector("input[type=file]"))'), false, 'Viewing a point must not enable upload')
    await capture('point-view')

    for (const outcome of ['cancel', 'fail']) {
      await click('扫一扫打卡')
      assert.equal(await evaluate('window.__simulatedScan.needResult'), 1)
      await evaluate(`window.__simulatedScan.${outcome}()`)
      await ready()
      assert.match(await evaluate('document.querySelector(".scan-message").textContent'), outcome === 'cancel' ? /已取消扫码/ : /相机权限/, 'cancel/permission feedback remains visible even when the scanner is ready again')
    }
    await click('扫一扫打卡')
    await evaluate(`window.__simulatedScan.success({ resultStr: ${JSON.stringify(`${origin}/r/not-a-point`)} })`)
    await ready()
    assert.match(await evaluate('document.body.textContent'), /不是有效的活动地点码/)
    await afterView()

    await click('扫一扫打卡')
    await evaluate(`window.__simulatedScan.success({ resultStr: ${JSON.stringify(`${origin}/q/p02`)} })`)
    await ready()
    await afterScan()
    assert.match(await evaluate('document.body.textContent'), /已识别当前扫码地点/)
    assert.equal(await evaluate(`document.querySelector('.point-count').textContent.trim()`), expectedProgress)
    assert.equal(new URL(await evaluate('location.href')).origin, origin)
    await capture('scan-ready')

    await click('扫一扫打卡')
    await evaluate("window.dispatchEvent(new Event('pageshow'))")
    await ready()
    await evaluate("window.__simulatedSdkError({errMsg:'config:fail'})")
    await waitFor(buttonExpression('重新准备扫一扫'), 'SDK retry button')
    await click('重新准备扫一扫')
    await ready()
    await call('Page.reload')
    await ready()
    assert.equal(await evaluate(`document.querySelector('.point-count').textContent.trim()`), expectedProgress)
    await afterScan()

    if (afterA1) await afterA1({ call, evaluate, click, waitFor, buttonExpression, ready, capture })

    await call('Network.clearBrowserCookies')
    await call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 HeadlessChrome A1-NORMAL-BROWSER-TEST' })
    await call('Page.navigate', { url: origin })
    await waitFor('document.body?.textContent.includes("请在微信内打开")', 'ordinary browser guidance')
    assert.equal(await evaluate(`${buttonExpression('扫一扫打卡')}.disabled`), true)
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      await call('Browser.close', {}, null).catch(() => {})
      socket.close()
    }
    for (const current of pending.values()) current.reject(new Error('Test browser closed'))
    pending.clear()
    if (browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, 'exit')
      browser.kill('SIGTERM')
      await exited
    }
  }
}
