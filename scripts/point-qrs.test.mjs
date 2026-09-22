import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { loadActivityConfig } from '../server/config.js'
import { parsePointQr } from '../server/wechat.js'
import { FINAL_ORIGIN, PRINT_WARNING, pointQrPlan, parseQrArguments, generatePointQrs } from './generate-point-qrs.mjs'

const expectedNames = ['葫芦娃', '卢氏大宗祠', '沉香古井', '苞榕', '文笔山顶']
const activity = loadActivityConfig()
const clone = () => structuredClone(activity)
const hash = value => createHash('sha256').update(value).digest('hex')

test('point QR: confirmed production payloads are exact and existing server parser agrees', () => {
  const rows = pointQrPlan(activity, FINAL_ORIGIN)
  assert.equal(rows.length, 5)
  rows.forEach((row, i) => {
    assert.equal(row.key, `p0${i + 1}`)
    assert.equal(row.name, expectedNames[i])
    assert.equal(row.url, `https://cq.fsxinhuo.cn/q/p0${i + 1}`)
    assert.equal(parsePointQr(row.url, FINAL_ORIGIN, activity.points).key, row.key)
    assert.doesNotMatch(row.url, /[\s?#]/)
  })
})

test('point QR: no implicit origin, trailing slash, query, hash, userinfo or disguised production host', () => {
  for (const origin of [undefined, '', 'http://localhost:3000', `${FINAL_ORIGIN}/`, `${FINAL_ORIGIN}?`, `${FINAL_ORIGIN}#`, ` ${FINAL_ORIGIN}`, `${FINAL_ORIGIN}/q/p01`, 'https://cq.fsxinhuo.cn.evil.test', 'https://user@cq.fsxinhuo.cn', 'https://cq.fsxinhuo.cn:443']) {
    assert.throws(() => pointQrPlan(activity, origin))
  }
  assert.throws(() => pointQrPlan(activity, FINAL_ORIGIN, { test: true }))
})

test('point QR: key/name reassignment, duplicate/empty/unsafe config fail before export', () => {
  for (const mutate of [a => { a.points[0].name = '错误地名' }, a => { a.points[0].key = 'p99' }, a => { a.points[1].key = 'p01' }, a => { a.points = [] }, a => { a.points[0].key = '../p01' }]) {
    const a = clone(); mutate(a)
    assert.throws(() => pointQrPlan(a, FINAL_ORIGIN))
  }
  const a = clone(); a.points[0].name = 'a/b'
  assert.throws(() => pointQrPlan(a, 'http://localhost:5173', { test: true }))
})

test('point QR: reordering/artwork changes cannot rebind printed keys; test export still reads dynamic N', () => {
  const a = clone()
  a.points.reverse().forEach((p, i) => { p.displayOrder = i + 1; p.image = null })
  assert.deepEqual(pointQrPlan(a, FINAL_ORIGIN), pointQrPlan(activity, FINAL_ORIGIN))
  a.points = a.points.slice(0, 3)
  assert.equal(pointQrPlan(a, 'http://localhost:5173', { test: true }).length, 3)
  assert.throws(() => pointQrPlan(a, FINAL_ORIGIN))
})

test('point QR CLI: explicit origin wins, output required, unknown/duplicate/missing args fail', () => {
  assert.equal(parseQrArguments(['--out', 'tmp/proof'], { PUBLIC_ORIGIN: FINAL_ORIGIN }).origin, FINAL_ORIGIN)
  assert.equal(parseQrArguments(['--origin', FINAL_ORIGIN, '--out', 'tmp/proof'], { PUBLIC_ORIGIN: 'http://localhost:3000' }).origin, FINAL_ORIGIN)
  for (const args of [[], ['--out'], ['--out', 'x', '--out', 'y'], ['--origin', '--out', 'x'], ['--out', 'x', '--unknown'], ['--test', '--test', '--out', 'x']]) assert.throws(() => parseQrArguments(args, {}))
  const child = spawnSync(process.execPath, ['scripts/generate-point-qrs.mjs', '--origin', `${FINAL_ORIGIN}/`, '--out', 'tmp/invalid-qr-must-not-exist'], { encoding: 'utf8' })
  assert.equal(child.status, 1)
  assert.match(child.stderr, /Origin must be canonical/)
})

test('point QR files: actual PNG pixels, quiet zone, SVG, CSV, hashes and offline paper proof; never overwrite', async () => {
  await fs.mkdir('tmp', { recursive: true })
  const temporary = await fs.mkdtemp(path.resolve('tmp', 'point-qr-unit-'))
  try {
    const out = path.join(temporary, 'production-proof')
    const { manifest } = await generatePointQrs({ origin: FINAL_ORIGIN, out })
    assert.equal((await fs.readdir(out)).length, 14)
    assert.equal(manifest.verification.bulkPrintApproved, false)
    assert.match(manifest.verification.automaticDecode, /not-verified/)
    for (const row of manifest.points) {
      const png = await fs.readFile(path.join(out, row.png)), svg = await fs.readFile(path.join(out, row.svg))
      assert.equal(hash(png), row.sha256.png); assert.equal(hash(svg), row.sha256.svg)
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      assert.equal(info.width, row.pngPixels); assert.equal(info.height, row.pngPixels)
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels
        const value = data[offset]
        assert.ok(value === 0 || value === 255, 'no blurred/coloured module pixels')
        assert.equal(data[offset + 1], value); assert.equal(data[offset + 2], value)
        if (x < 96 || y < 96 || x >= info.width - 96 || y >= info.height - 96) assert.equal(value, 255, 'four modules of white quiet zone')
      }
      assert.match(svg.toString(), /<svg/)
      assert.doesNotMatch(svg.toString(), /<image|<text|gradient|filter/i)
    }
    const csv = await fs.readFile(path.join(out, '地点二维码清单.csv'), 'utf8')
    assert.equal(csv.charCodeAt(0), 0xfeff)
    manifest.points.forEach(row => assert.ok(csv.includes(row.url) && csv.includes(row.png)))
    const page = await fs.readFile(path.join(out, 'index.html'), 'utf8')
    assert.ok(page.includes(PRINT_WARNING)); assert.match(page, /width:50mm;height:50mm/)
    assert.equal((page.match(/<img class="qr"/g) || []).length, 5)
    const before = await fs.readFile(path.join(out, 'manifest.json'))
    await assert.rejects(generatePointQrs({ origin: FINAL_ORIGIN, out }), { code: 'EEXIST' })
    await assert.rejects(generatePointQrs({ origin: 'http://localhost:5173', out, test: true }), { code: 'EEXIST' })
    assert.deepEqual(await fs.readFile(path.join(out, 'manifest.json')), before)
    // Pixels/files are checked here, NOT decoded; real decoding is a separate evidence step.
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
})
