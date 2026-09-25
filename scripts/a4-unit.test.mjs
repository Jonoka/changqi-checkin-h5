import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { sendPage } from '../server/http.js'
import { mountGuide } from '../server/a1.js'
import { createScanner } from '../web/src/wechat-scan.js'
import { createHash } from 'node:crypto'
import { loadActivityConfig, validateActivityConfig } from '../server/config.js'
import { villageMapLayout, mapArtwork } from '../web/src/map-layout.js'
import { reusableA4Evidence, a4CaptureRequested } from './check-a4-browser.mjs'

test('UI: selected fresh screenshots never masquerade as a complete or reused set', () => {
  assert.equal(a4CaptureRequested('home', 320, undefined), true)
  assert.equal(a4CaptureRequested('home', 320, 'home@320,claim-ready@390'), true)
  assert.equal(a4CaptureRequested('home', 430, 'home@320,claim-ready@390'), false)
  assert.throws(() => a4CaptureRequested('home', 320, 'home@319'), /Invalid A4/)
  assert.throws(() => a4CaptureRequested('home', 320, '../old@320'), /Invalid A4/)
})

test('A5: visual evidence reuse rejects changed runtime, missing images and unsafe filenames', async () => {
  await fs.mkdir('tmp', { recursive: true })
  const dir = await fs.mkdtemp('tmp/a5-evidence-unit-')
  const version = { runtimeSha256: 'test-fingerprint', files: [{ path: 'test-only.js', sha256: 'test-sha' }] }
  const evidence = { version, screenshots: [{ file: 'a4-home-390.png' }] }
  const write = () => fs.writeFile(`${dir}/a4-screenshots.json`, JSON.stringify(evidence))
  try {
    await write()
    await assert.rejects(reusableA4Evidence(dir, { ...version, runtimeSha256: 'changed' }), /fingerprint changed/)
    await assert.rejects(reusableA4Evidence(dir, { ...version, files: [] }), /same runtime/)
    await assert.rejects(reusableA4Evidence(dir, version), { code: 'ENOENT' })
    await fs.writeFile(`${dir}/a4-home-390.png`, 'test-only nonempty fixture; not visual evidence')
    assert.equal((await reusableA4Evidence(dir, version)).screenshotCount, 1)
    evidence.screenshots[0].file = '../outside.png'; await write()
    await assert.rejects(reusableA4Evidence(dir, version), /local A4/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

function renderPage(options) {
  const response = { statusCode: null, headers: {}, set(name, value) { this.headers[name] = value; return this }, status(code) { this.statusCode = code; return this }, type() { return this }, send(html) { this.html = html; return this } }
  return sendPage(response, options)
}

test('A4: non-WeChat location guides use the participation title without granting eligibility', () => {
  const activity = loadActivityConfig()
  let handler
  mountGuide({ get(route, callback) { assert.equal(route, '/q/:pointKey'); handler = callback } }, activity, { mockEnabled: false })
  for (const point of activity.points) {
    const response = { headers: {}, set(name, value) { if (typeof name === 'object') Object.assign(this.headers, name); else this.headers[name] = value; return this }, vary(name) { this.headers.Vary = name; return this }, status(code) { this.statusCode = code; return this }, type() { return this }, send(html) { this.html = html; return this } }
    handler({ params: { pointKey: point.key }, get: () => 'ordinary browser' }, response)
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
  assert.match(page.html, /使用微信扫一扫现场地点二维码/)
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

// File integrity and key association are not a substitute for final customer page approval.
test('A4: imported landmark artwork and final map have accurate runtime dimensions' , async () => {
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
    assert.equal(image.format, 'webp'); assert.equal(image.width, file.width); assert.equal(image.height, file.height)
    assert.equal(point.imageWidth, image.width); assert.equal(point.imageHeight, image.height)
    assert.equal(point.imageWidth / point.imageHeight, 3 / 2)
    assert.ok(image.width > 0 && image.width <= 1600 && image.height > 0 && image.height <= 2000)
    assert.ok(data.length > 1000 && data.length < 1500000)
    assert.equal(data.length, file.bytes)
    const hash = createHash('sha256').update(data).digest('hex')
    assert.equal(hash, file.sha256); hashes.add(hash)
  }
  assert.equal(hashes.size, 5)
  assert.equal(mapArtwork.image, '/art/map-field-final-v2.webp')
  const masterBytes = await fs.readFile(new URL('../assets/illustrations/restoration/masters/map-field-final-v2.png', import.meta.url))
  const masterImage = await sharp(masterBytes).metadata()
  assert.equal(masterImage.format, 'png'); assert.equal(masterImage.width, 1377); assert.equal(masterImage.height, 1142)
  assert.equal(masterBytes.length, 3439453)
  assert.equal(createHash('sha256').update(masterBytes).digest('hex'), '236031caf5869710d9671893dc2ac21ec015b282d5791cf9af82defa670c353e')
  const mapBytes = await fs.readFile(new URL(`../web/public${mapArtwork.image}`, import.meta.url))
  const mapImage = await sharp(mapBytes).metadata()
  assert.equal(mapImage.format, 'webp'); assert.equal(mapImage.width, mapArtwork.width); assert.equal(mapImage.height, mapArtwork.height)
  assert.equal(mapImage.width / mapImage.height, masterImage.width / masterImage.height)
  assert.equal(mapBytes.length, 485720)
  assert.equal(createHash('sha256').update(mapBytes).digest('hex'), '8c8d376ff3f0807cf8cce7a3afdfe266a61d7e3aff5e3806bf0b0577b477462c')
  const mapComponent = await fs.readFile(new URL('../web/src/VillageMap.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(mapComponent, /map-route-overlay|map-route-line|claim-map-marker|claim-map-gift|map-pin|PointArt|map-environment/)
  assert.ok(manifest.files.reduce((sum, file) => sum + file.bytes, 0) < 5000000)
  // PNG source hashes, native crop pixels, missing-master gate and output ownership are tested
  // in a4-image-art.test.mjs; the historical SVG fingerprint is no longer an art-generation input.
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
  for (const value of [{ x: 4.9, y: 50 }, { x: 50, y: 95.1 }, { x: '50', y: 50 }, { x: NaN, y: 50 }]) {
    const config = structuredClone(base); config.points[0].mapPosition = value
    assert.throws(() => validateActivityConfig(config), /mapPosition/)
  }
  for (const [width, height] of [[0, 640], [960, -1], ['960', 640], [960, undefined], [Infinity, 640]]) {
    const config = structuredClone(base); config.points[0].imageWidth = width; config.points[0].imageHeight = height
    assert.throws(() => validateActivityConfig(config), /imageWidth\/imageHeight/)
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
  assert.equal(normal.placement, 'final-map')
  for (const before of normal.nodes) {
    const after = reordered.nodes.find(node => node.point.key === before.point.key)
    assert.equal(after.point.image, before.point.image); assert.equal(after.point.photoTip, before.point.photoTip)
    assert.equal(after.x, before.x); assert.equal(after.y, before.y)
  }
  assert.equal(Object.hasOwn(normal, 'routeSegments'), false)
  assert.equal(Object.hasOwn(normal, 'claimPosition'), false)
  assert.equal(normal.width, reordered.width); assert.equal(normal.height, reordered.height)
})

test('A4: variable N never stretches the image or invents anchors for unpositioned locations', () => {
  const original = loadActivityConfig().points
  for (const count of [0, 1, 2, 5, 6, 9]) {
    const added = Array.from({ length: count }, (_, i) => ({ key: `test-${i}`, name: `地点${i + 1}`, image: null, displayOrder: i + 20 }))
    const points = [...original.slice(0, count), ...added].reverse()
    const layout = villageMapLayout(points)
    assert.equal(layout.width, mapArtwork.width); assert.equal(layout.height, mapArtwork.height)
    assert.equal(layout.nodes.length, Math.min(count, original.length))
    assert.deepEqual(layout.unmappedKeys, [...added].reverse().map(point => point.key))
    for (const node of layout.nodes) {
      const source = original.find(point => point.key === node.point.key)
      assert.equal(node.x, source.mapPosition.x); assert.equal(node.y, source.mapPosition.y)
      assert.equal(node.point.image, source.image)
    }
  }
  const removed = villageMapLayout(original.filter(point => point.key !== 'p03'))
  assert.ok(removed.nodes.every(node => node.point.key !== 'p03'))
  assert.equal(removed.width / removed.height, mapArtwork.width / mapArtwork.height)
})

test('A4: guide offers direct WeChat scanning and optional account entry without a placeholder QR', () => {
  const without = renderPage({ title: '地点引导', message: '请使用微信打开', guide: true })
  assert.match(without.html, /使用微信扫一扫现场地点二维码/); assert.match(without.html, /印象芦苞/); assert.match(without.html, /也可从/)
  assert.doesNotMatch(without.html, /关注后|已关注用户|底部菜单/)
  assert.doesNotMatch(without.html, /<img[^>]+class="guide-qr"/)
  const supplied = renderPage({ title: '地点引导', message: '请使用微信打开', guide: true, officialAccountQr: '/art/verified-account-qr.png' })
  assert.ok(supplied.html.includes('<img class="guide-qr" src="/art/verified-account-qr.png"'))
  const rejected = renderPage({ title: '地点引导', message: '', guide: true, officialAccountQr: 'https://invalid.test/qr.png' })
  assert.doesNotMatch(rejected.html, /<img[^>]+class="guide-qr"/)
})
