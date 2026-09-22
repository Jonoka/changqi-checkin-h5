import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { sendPage } from '../server/http.js'

function renderPage(options) {
  const response = { statusCode: null, headers: {}, set(name, value) { this.headers[name] = value; return this }, status(code) { this.statusCode = code; return this }, type() { return this }, send(html) { this.html = html; return this } }
  return sendPage(response, options)
}

test('A4: standalone guide escapes content, has no fake QR or direct upload/auth button and remains non-cacheable', () => {
  const page = renderPage({ title: '<script>bad()</script>', message: '<img src=x onerror=bad()>', guide: true })
  assert.equal(page.statusCode, 200)
  assert.equal(page.headers['Cache-Control'], 'no-store')
  assert.ok(page.html.includes('&lt;script&gt;'))
  assert.ok(page.html.includes('&lt;img src=x onerror=bad()&gt;'))
  assert.doesNotMatch(page.html, /<script>|<img src=x|href="\/auth|type="file"|claim-qr/)
  assert.match(page.html, /公众号底部菜单|活动页面内的扫一扫/)
})

test('A4: authorization error keeps its status and explicit retry, not an automatic redirect or success', () => {
  const page = renderPage({ status: 400, code: 'OAUTH_STATE_INVALID', title: '授权未完成', message: '请重新授权', retry: true })
  assert.equal(page.statusCode, 400)
  assert.match(page.html, /data-error-code="OAUTH_STATE_INVALID"/)
  assert.match(page.html, /href="\/auth\/wechat"/)
  assert.doesNotMatch(page.html, /http-equiv="refresh"|location\.assign|登录成功/)
})

test('A4: approved artwork is shipped as two cropped WebP illustrations, not full reference screens', async () => {
  for (const [filename, width, height] of [['village.webp', 650, 310], ['lane.webp', 640, 265]]) {
    const data = await fs.readFile(new URL(`../web/public/art/${filename}`, import.meta.url))
    const image = await sharp(data).metadata()
    assert.equal(image.format, 'webp')
    assert.equal(image.width, width); assert.equal(image.height, height)
    assert.ok(data.length < 100000)
  }
})
