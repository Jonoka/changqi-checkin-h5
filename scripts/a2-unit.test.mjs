import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { processPhoto, storedPhotoPath, maxPhotoBytes } from '../server/photos.js'
import { runtimeConfig } from '../server/runtime.js'
import { uploadWithRecovery } from '../web/src/photo-upload.js'

async function temporary(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'changqi-a2-unit-'))
  try { return await run(directory) } finally { await fs.rm(directory, { recursive: true, force: true }) }
}
const image = (width = 80, height = 50) => sharp({ create: { width, height, channels: 3, background: '#537743' } })

test('A2: actual JPEG/PNG/WebP bytes decode to JPEG; names do not decide type; small images are not enlarged', async () => {
  await temporary(async (dir) => {
    for (const format of ['jpeg', 'png', 'webp']) {
      const input = path.join(dir, `${format}.untrusted-extension`)
      const output = path.join(dir, `${format}.jpg`)
      await image().toFormat(format).toFile(input)
      await processPhoto(input, output)
      const meta = await sharp(output).metadata()
      assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, 80); assert.equal(meta.height, 50)
      assert.equal(meta.exif, undefined)
    }
  })
})
test('A2: EXIF orientation corrected, longest edge at most 1600px, metadata stripped', async () => {
  await temporary(async (dir) => {
    const input = path.join(dir, 'rotated.jpg'), output = path.join(dir, 'output.jpg')
    await image(2400, 1200).withMetadata({ orientation: 6 }).jpeg().toFile(input)
    await processPhoto(input, output)
    const meta = await sharp(output).metadata()
    assert.equal(meta.width, 800); assert.equal(meta.height, 1600)
    assert.equal(meta.orientation, undefined); assert.equal(meta.exif, undefined)
  })
})
test('A2: damaged/empty/SVG/GIF input is rejected; no successful output file', async () => {
  await temporary(async (dir) => {
    const jpeg = await image().jpeg().toBuffer()
    const cases = [Buffer.alloc(0), Buffer.from('not a photo'), jpeg.subarray(0, Math.floor(jpeg.length / 2)), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>'), await image().gif().toBuffer()]
    for (const [i, data] of cases.entries()) {
      const input = path.join(dir, `bad-${i}.jpg`), output = path.join(dir, `out-${i}.jpg`)
      await fs.writeFile(input, data)
      await assert.rejects(processPhoto(input, output), { code: 'UNSUPPORTED_IMAGE', status: 415 })
      await assert.rejects(fs.stat(output), { code: 'ENOENT' })
    }
  })
})
test('A2: disk output failure is not reported as an unsupported image', async () => {
  await temporary(async (dir) => {
    const input = path.join(dir, 'input.jpg')
    await image().jpeg().toFile(input)
    await assert.rejects(processPhoto(input, path.join(dir, 'missing', 'output.jpg')), { code: 'ENOENT' })
  })
})
test('A2: stored filenames cannot escape directory; public or in-package production upload roots rejected', () => {
  assert.equal(maxPhotoBytes, 15728640)
  for (const name of ['../secret', '/etc/passwd', 'x.jpg', 'a'.repeat(32) + '.jpg/extra', 'C:\\secret']) assert.throws(() => storedPhotoPath('/tmp', name), { code: 'PHOTO_MISSING' })
  assert.equal(path.basename(storedPhotoPath('/tmp', 'a'.repeat(32) + '.jpg')), 'a'.repeat(32) + '.jpg')
  assert.throws(() => runtimeConfig({ UPLOAD_DIR: './web/public/uploads' }), /outside/)
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://test.invalid', WECHAT_APP_ID: 'test', WECHAT_APP_SECRET: 'test', SESSION_SECRET: 'x'.repeat(32), UPLOAD_DIR: './var/uploads' }), /persistent directory/)
})
const state = (completedKeys) => ({ completedKeys, completedCount: completedKeys.length, totalCount: 5 })
test('A2: lost upload response reads server state before offering retry and never uploads twice', async () => {
  const calls = []
  const result = await uploadWithRecovery({ pointKey: 'p01', file: {}, upload: async () => { calls.push('upload'); throw new Error('SIMULATED timeout after save') }, readState: async () => { calls.push('read'); return state(['p01']) } })
  assert.deepEqual(calls, ['upload', 'read']); assert.equal(result.recovered, true)
  assert.equal(result.state.completedCount, 1)
})
test('A2: a failed save does not increment progress; failed verification blocks blind retry', async () => {
  await assert.rejects(uploadWithRecovery({ pointKey: 'p01', file: {}, upload: async () => { throw new Error('save failed') }, readState: async () => state([]) }), (error) => error.message === 'save failed' && error.currentState.completedCount === 0)
  await assert.rejects(uploadWithRecovery({ pointKey: 'p01', file: {}, upload: async () => { throw new Error('timeout') }, readState: async () => { throw new Error('offline') } }), { code: 'VERIFY_REQUIRED' })
})
test('A2: expired login during verification asks for login, and incomplete success is rechecked', async () => {
  await assert.rejects(uploadWithRecovery({ pointKey: 'p01', upload: async () => state([]), readState: async () => { throw Object.assign(new Error('login required'), { code: 'NEED_LOGIN' }) } }), { code: 'NEED_LOGIN' })
  const result = await uploadWithRecovery({ pointKey: 'p01', upload: async () => state([]), readState: async () => state(['p01']) })
  assert.equal(result.recovered, true)
})
