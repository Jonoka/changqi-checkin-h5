import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { sendPage } from '../server/http.js'
import { mountGuide } from '../server/a1.js'
import { createScanner } from '../web/src/wechat-scan.js'
import { createHash } from 'node:crypto'
import { loadActivityConfig, validateActivityConfig } from '../server/config.js'
import { villageMapLayout } from '../web/src/map-layout.js'
import { illustrations } from '../assets/illustrations/village-art.mjs'

function renderPage(options) {
  const response = { statusCode: null, headers: {}, set(name, value) { this.headers[name] = value; return this }, status(code) { this.statusCode = code; return this }, type() { return this }, send(html) { this.html = html; return this } }
  return sendPage(response, options)
}

test('A4: all valid location guides use the participation title without granting scan eligibility', () => {
  const activity = loadActivityConfig()
  let handler
  mountGuide({ get(route, callback) { assert.equal(route, '/q/:pointKey'); handler = callback } }, activity, { mockEnabled: false })
  for (const point of activity.points) {
    const response = { headers: {}, set(name, value) { this.headers[name] = value; return this }, status(code) { this.statusCode = code; return this }, type() { return this }, send(html) { this.html = html; return this } }
    handler({ params: { pointKey: point.key } }, response)
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['Cache-Control'], 'no-store')
    assert.match(response.html, /<title>参与方式<\/title>/)
    assert.match(response.html, /<h1>参与方式<\/h1>/)
    assert.doesNotMatch(response.html, /公众号入口引导|type="file"/)
  }
})

test('A4: scanner ready is silent while cancellation and permission feedback remain visible', async () => {
  const state = { phase: 'idle', message: '' }
  let ready, scanOptions
  const sdk = { config() {}, error() {}, ready(callback) { ready = callback }, scanQRCode(options) { scanOptions = options } }
  const scanner = createScanner({ state, loadSdk: async () => sdk, getConfig: async () => ({}), submit: async () => ({}), onPoint() {} })
  try {
    const initializing = scanner.initialize()
    for (let attempt = 0; attempt < 10 && !ready; attempt++) await Promise.resolve()
    assert.equal(typeof ready, 'function', 'SDK ready handler is registered')
    assert.equal(state.phase, 'initializing')
    assert.match(state.message, /正在准备/)
    ready(); assert.equal(await initializing, true)
    assert.equal(state.phase, 'ready'); assert.equal(state.message, '')
    const cancelled = scanner.scan(); scanOptions.cancel(); await cancelled
    assert.equal(state.phase, 'ready'); assert.match(state.message, /已取消扫码/)
    const denied = scanner.scan(); scanOptions.fail(); await denied
    assert.equal(state.phase, 'ready'); assert.match(state.message, /相机权限/)
  } finally { scanner.dispose() }
})

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

test('A4: legacy crop files remain preserved at their original dimensions', async () => {
  for (const [filename, width, height] of [['village.webp', 650, 310], ['lane.webp', 640, 265]]) {
    const data = await fs.readFile(new URL(`../web/public/art/${filename}`, import.meta.url))
    const image = await sharp(data).metadata()
    assert.equal(image.format, 'webp')
    assert.equal(image.width, width); assert.equal(image.height, height)
    assert.ok(data.length < 100000)
  }
})

test('A4: five keyed landmarks have distinct compressed artwork and appropriate descriptive copy', async () => {
  const config = loadActivityConfig()
  const manifest = JSON.parse(await fs.readFile(new URL('../web/public/art/illustration-manifest.json', import.meta.url), 'utf8'))
  const hashes = new Set()
  const themes = { p01: ['葫芦'], p02: ['祠堂'], p03: ['井'], p04: ['树', '气根'], p05: ['村落', '山林'] }
  for (const [key, words] of Object.entries(themes)) {
    const point = config.points.find(point => point.key === key)
    assert.ok(point)
    assert.ok(point.image.startsWith(`/art/point-${key}-`) && point.image.endsWith('.webp'))
    assert.match(point.imageAlt, /概念/)
    for (const word of words) assert.ok(`${point.photoTip} ${point.imageAlt}`.includes(word), `${key}: ${word}`)
    const file = manifest.files.find(file => file.path === `web/public${point.image}`)
    assert.ok(file)
    const data = await fs.readFile(new URL(`../${file.path}`, import.meta.url))
    const image = await sharp(data).metadata()
    assert.equal(image.format, 'webp'); assert.equal(image.width, 720); assert.equal(image.height, 480)
    assert.ok(data.length > 1000 && data.length < 50000)
    assert.equal(data.length, file.bytes)
    const hash = createHash('sha256').update(data).digest('hex')
    assert.equal(hash, file.sha256); hashes.add(hash)
  }
  assert.equal(hashes.size, 5)
  const map = manifest.files.find(file => file.path.endsWith('/map-environment.webp'))
  assert.equal(map.width, 720); assert.equal(map.height, 1240); assert.ok(map.bytes < 100000)
  assert.ok(manifest.files.reduce((sum, file) => sum + file.bytes, 0) < 200000)
  for (const svg of Object.values(illustrations)) assert.doesNotMatch(svg, /<text\b|<image\b|<foreignObject\b|<script\b/)
  assert.equal(manifest.sourceSha256, createHash('sha256').update(await fs.readFile(new URL('../assets/illustrations/village-art.mjs', import.meta.url))).digest('hex'))
  for (const filename of ['web/src/App.vue', 'web/src/VillageMap.vue', 'web/src/ClaimPage.vue', 'server/http.js']) {
    assert.doesNotMatch(await fs.readFile(new URL(`../${filename}`, import.meta.url), 'utf8'), /\/art\/(?:lane|village)\.webp/)
  }
})

test('A4: local artwork, optional copy, focus and manual coordinates are validated', () => {
  const base = loadActivityConfig()
  for (const invalid of ['https://invalid.test/image.png', '//invalid.test/image.png', '/art/../x.png', '/art/x.svg?x=1', 'data:image/png;base64,AA', 'javascript:bad()']) {
    const config = structuredClone(base); config.points[0].image = invalid
    assert.throws(() => validateActivityConfig(config), /image/)
    const qr = structuredClone(base); qr.wechat.officialAccountQr = invalid
    assert.throws(() => validateActivityConfig(qr), /officialAccountQr/)
  }
  for (const value of [{ x: 14, y: 50 }, { x: 50, y: 89 }, { x: '50', y: 50 }, { x: NaN, y: 50 }]) {
    const config = structuredClone(base); config.points[0].mapPosition = value
    assert.throws(() => validateActivityConfig(config), /mapPosition/)
  }
  const focus = structuredClone(base); focus.points[0].imagePosition = '101% 50%'
  assert.throws(() => validateActivityConfig(focus), /imagePosition/)
  const copy = structuredClone(base); copy.points[0].photoTip = 'x'.repeat(161)
  assert.throws(() => validateActivityConfig(copy), /photoTip/)
  const optional = structuredClone(base); optional.points[0].image = null; delete optional.points[0].mapPosition
  assert.doesNotThrow(() => validateActivityConfig(optional))
})

test('A4: reordering preserves artwork, copy and manual map positions by key', () => {
  const points = loadActivityConfig().points
  const normal = villageMapLayout(points)
  const reordered = villageMapLayout([...points].reverse())
  assert.equal(normal.placement, 'configured')
  for (const before of normal.nodes) {
    const after = reordered.nodes.find(node => node.point.key === before.point.key)
    assert.equal(after.point.image, before.point.image); assert.equal(after.point.photoTip, before.point.photoTip)
    assert.equal(after.x, before.x); assert.equal(after.y, before.y)
  }
  assert.match(normal.route, /^M .* C /); assert.notEqual(normal.route, reordered.route)
})

test('A4: missing positions use a bounded non-overlapping fallback for variable N', () => {
  for (const count of [1, 2, 5, 6, 9]) {
    const points = Array.from({ length: count }, (_, i) => ({ key: `test-${i}`, name: `地点${i + 1}`, image: null, displayOrder: count - i, ...(i ? {} : { mapPosition: { x: 27, y: 49 } }) }))
    delete points.at(-1).mapPosition
    const layout = villageMapLayout(points)
    assert.equal(layout.placement, 'fallback'); assert.equal(layout.nodes.length, count)
    for (const node of layout.nodes) {
      assert.ok(node.x >= 78 && node.x <= layout.width - 78)
      assert.ok(node.y >= 80 && node.y <= layout.height - 80)
      assert.equal(node.point, points.find(point => point.key === node.point.key))
    }
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      assert.ok(Math.abs(layout.nodes[i].x - layout.nodes[j].x) >= 155 || Math.abs(layout.nodes[i].y - layout.nodes[j].y) >= 155, `N=${count}: no overlapping targets`)
    }
  }
})

test('A4: guide uses account-name search and never generates a placeholder official-account QR', () => {
  const without = renderPage({ title: '地点引导', message: '请从菜单进入', guide: true })
  assert.match(without.html, /搜索并打开公众号/); assert.match(without.html, /印象芦苞/); assert.match(without.html, /底部菜单/)
  assert.doesNotMatch(without.html, /<img[^>]+class="guide-qr"/)
  const supplied = renderPage({ title: '地点引导', message: '请从菜单进入', guide: true, officialAccountQr: '/art/verified-account-qr.png' })
  assert.ok(supplied.html.includes('<img class="guide-qr" src="/art/verified-account-qr.png"'))
  const rejected = renderPage({ title: '地点引导', message: '', guide: true, officialAccountQr: 'https://invalid.test/qr.png' })
  assert.doesNotMatch(rejected.html, /<img[^>]+class="guide-qr"/)
})
