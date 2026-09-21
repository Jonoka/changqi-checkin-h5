import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { findOrCreateUser } from '../server/identity.js'
import { findCheckin, maxPhotoBytes } from '../server/photos.js'

export async function uploadFile(baseUrl, client, pointKey, bytes, options = {}) {
  const form = new FormData()
  form.append('pointKey', pointKey)
  if (bytes !== null) form.append(options.field || 'photo', new Blob([bytes], { type: options.type || 'image/jpeg' }), options.name || 'onsite-test.jpg')
  if (options.extra) form.append('userId', options.extra)
  const response = await fetch(`${baseUrl}/api/checkins`, { method: 'POST', headers: { cookie: client.cookie, ...options.headers }, body: form, signal: AbortSignal.timeout(30000) })
  const text = await response.text()
  let payload
  try { payload = JSON.parse(text) } catch { throw new Error(`Upload response was not JSON: status=${response.status}, authenticated=${Boolean(client.cookie)}, point=${pointKey}, bytes=${bytes?.length ?? 0}, responseBytes=${text.length}`) }
  return { status: response.status, payload }
}
async function photo(baseUrl, client, key) {
  const response = await fetch(`${baseUrl}/api/me/photos/${key}`, { headers: { cookie: client.cookie }, signal: AbortSignal.timeout(12000) })
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, bytes, payload: response.ok ? null : JSON.parse(bytes.toString()) }
}
async function files(directory) {
  try { return (await fs.readdir(directory)).filter((name) => name.endsWith('.jpg')).sort() } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
async function noTemporaryFiles(directory) {
  const temporary = await fs.readdir(path.join(directory, '.tmp')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))
  assert.deepEqual(temporary, [], 'Every request must remove its own temporary directory')
}
async function interruptedUpload(baseUrl, client) {
  const prefix = '--a2-boundary\r\nContent-Disposition: form-data; name="pointKey"\r\n\r\np05\r\n--a2-boundary\r\nContent-Disposition: form-data; name="photo"; filename="partial.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'
  await new Promise((resolve) => {
    const request = http.request(`${baseUrl}/api/checkins`, { method: 'POST', headers: { cookie: client.cookie, 'content-type': 'multipart/form-data; boundary=a2-boundary', 'content-length': 1000000 } })
    request.on('error', () => resolve())
    request.on('response', (response) => { response.resume(); resolve() })
    request.write(prefix)
    request.write(Buffer.alloc(16384))
    setTimeout(() => { request.destroy(); resolve() }, 150)
  })
  await delay(250)
}

// All database work uses the random database created by the existing A1 harness.
export async function checkA2Mysql({ pool, activity, runtime, baseUrl, directory, browser, oauth, ok }) {
  const fixtures = path.join(directory, 'photo-fixtures')
  await fs.mkdir(fixtures, { recursive: true })
  const samplePath = path.join(fixtures, 'photograph.jpg')
  if (process.env.TEST_PHOTO_PATH) {
    await fs.copyFile(process.env.TEST_PHOTO_PATH, samplePath)
    console.log('A2 image source: supplied photographic test fixture, not a verified Changqi onsite photograph')
  } else {
    await sharp({ create: { width: 320, height: 240, channels: 3, background: '#51734c' } }).jpeg().toFile(samplePath)
    console.log('A2 image source: GENERATED image fixture; external photographic sample not supplied')
  }
  const jpeg = await fs.readFile(samplePath)
  const png = await sharp({ create: { width: 360, height: 200, channels: 3, background: '#c59b31' } }).png().toBuffer()
  const webp = await sharp(jpeg).webp().toBuffer()
  const pngPath = path.join(fixtures, 'second.png'), badPath = path.join(fixtures, 'damaged.jpg')
  await fs.writeFile(pngPath, png); await fs.writeFile(badPath, 'not an image')
  const a = browser(baseUrl), b = browser(baseUrl), anon = browser(baseUrl)
  await oauth(a, 'a2-user-a'); await oauth(b, 'a2-user-b')
  const aUser = await findOrCreateUser(pool, 'simulated-a2-user-a')
  const bUser = await findOrCreateUser(pool, 'simulated-a2-user-b')
  const progress = async (client) => (await client.request('/api/me')).payload.data
  const scan = async (client, key) => {
    const result = await client.request('/api/scan', { body: { result: `${runtime.publicOrigin}/q/${key}` } })
    assert.equal(result.status, 200)
  }
  const checkError = async (promise, status, code) => {
    const result = await promise
    assert.equal(result.status, status, JSON.stringify(result.payload))
    assert.equal(result.payload.error.code, code)
    await noTemporaryFiles(runtime.uploadDir)
    return result
  }
  await checkError(uploadFile(baseUrl, anon, 'p01', jpeg), 401, 'NEED_LOGIN')
  assert.equal((await photo(baseUrl, anon, 'p01')).status, 401)
  await a.request('/q/p01')
  await checkError(uploadFile(baseUrl, a, 'p01', jpeg), 403, 'PLEASE_SCAN')
  await checkError(uploadFile(baseUrl, a, '../p01', jpeg), 404, 'INVALID_POINT')
  await scan(a, 'p01')
  await checkError(uploadFile(baseUrl, a, 'p02', jpeg), 403, 'PLEASE_SCAN')
  await checkError(uploadFile(baseUrl, a, 'p01', null), 400, 'PHOTO_REQUIRED')
  await checkError(uploadFile(baseUrl, a, 'p01', jpeg, { extra: String(bUser.id) }), 400, 'INVALID_UPLOAD')
  await checkError(uploadFile(baseUrl, a, 'p01', jpeg, { headers: { origin: 'https://other.invalid' } }), 403, 'INVALID_ORIGIN')
  assert.equal((await progress(a)).completedCount, 0)
  ok('A2: upload/photo APIs require sessions; direct /q, unscanned/wrong point, extra identity and cross-origin submissions never grant a check-in')

  const beforeInvalid = await files(runtime.uploadDir)
  await checkError(uploadFile(baseUrl, a, 'p01', Buffer.alloc(maxPhotoBytes + 1)), 413, 'IMAGE_TOO_LARGE')
  for (const bytes of [Buffer.from('corrupt'), jpeg.subarray(0, Math.floor(jpeg.length / 3)), Buffer.from('<svg width="1" height="1"></svg>'), await sharp(png).gif().toBuffer()]) {
    await checkError(uploadFile(baseUrl, a, 'p01', bytes), 415, 'UNSUPPORTED_IMAGE')
  }
  await checkError(uploadFile(baseUrl, a, 'p01', jpeg, { field: 'unexpected-photo' }), 400, 'INVALID_UPLOAD')
  const malformed = await fetch(`${baseUrl}/api/checkins`, { method: 'POST', headers: { cookie: a.cookie, 'content-type': 'multipart/form-data; boundary=broken' }, body: '--broken\r\ninvalid', signal: AbortSignal.timeout(12000) })
  assert.equal(malformed.status, 400)
  await noTemporaryFiles(runtime.uploadDir)
  assert.deepEqual(await files(runtime.uploadDir), beforeInvalid)
  assert.equal((await progress(a)).completedCount, 0)
  ok('A2: oversized, corrupted, unsupported and malformed multipart uploads leave no check-in or temporary photo')

  const first = await uploadFile(baseUrl, a, 'p01', jpeg, { name: '../../untrusted.bin', type: 'application/octet-stream' })
  assert.equal(first.status, 200, JSON.stringify(first.payload)); assert.equal(first.payload.data.completedCount, 1)
  const firstRow = await findCheckin(pool, aUser.id, 'p01')
  assert.match(firstRow.photo_path, /^[a-f0-9]{32}\.jpg$/)
  const firstPath = path.join(runtime.uploadDir, firstRow.photo_path)
  const savedBytes = await fs.readFile(firstPath)
  const metadata = await sharp(savedBytes).metadata()
  assert.equal(metadata.format, 'jpeg'); assert.ok(metadata.width <= 1600 && metadata.height <= 1600)
  assert.equal(metadata.exif, undefined)
  assert.doesNotMatch(JSON.stringify(first.payload), /photo_path|openid|password|uploadDir/)
  const own = await photo(baseUrl, a, 'p01')
  assert.equal(own.status, 200); assert.deepEqual(own.bytes, savedBytes)
  assert.match(own.headers.get('cache-control'), /no-store/); assert.equal(own.headers.get('x-content-type-options'), 'nosniff')
  assert.equal((await photo(baseUrl, b, `p01?userId=${aUser.id}`)).status, 404)
  const rawFile = await fetch(`${baseUrl}/uploads/${firstRow.photo_path}`)
  assert.ok(!rawFile.headers.get('content-type')?.startsWith('image/'), 'Persistent photo must never be publicly served')
  await noTemporaryFiles(runtime.uploadDir)
  ok('A2: actual photograph bytes saved through multipart → JPEG file → MySQL; only owner can read; filenames/MIME cannot forge type')

  await scan(b, 'p01')
  const secondOwner = await uploadFile(baseUrl, b, 'p01', png, { type: 'image/png' })
  assert.equal(secondOwner.status, 200)
  assert.notDeepEqual((await photo(baseUrl, b, 'p01')).bytes, savedBytes)
  assert.deepEqual((await photo(baseUrl, a, 'p01')).bytes, savedBytes)
  await oauth(a, 'a2-user-a') // Fresh session, no scannedPointKey; a saved record remains idempotent.
  const fileCountBeforeRepeat = (await files(runtime.uploadDir)).length
  const repeat = await uploadFile(baseUrl, a, 'p01', png)
  assert.equal(repeat.status, 200); assert.equal(repeat.payload.data.completedCount, 1)
  assert.deepEqual(await findCheckin(pool, aUser.id, 'p01'), firstRow)
  assert.deepEqual(await fs.readFile(firstPath), savedBytes)
  assert.equal((await files(runtime.uploadDir)).length, fileCountBeforeRepeat)
  ok('A2: two users at the same point retain separate private photos; repeated upload/new login preserves the first successful photo')

  await scan(a, 'p02')
  assert.equal((await uploadFile(baseUrl, a, 'p02', webp, { type: 'image/webp' })).payload.data.completedCount, 2)
  await scan(a, 'p03')
  assert.equal((await progress(a)).completedCount, 2)
  assert.equal((await uploadFile(baseUrl, a, 'p03', jpeg)).payload.data.completedCount, 3)
  await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path) VALUES (?, ?, ?)', [aUser.id, 'a2-retired-key', 'TEST-HISTORICAL-NO-PHOTO'])
  assert.equal((await progress(a)).completedCount, 3)
  assert.equal((await progress(a)).allCompleted, false)
  ok('A2: real JPEG/PNG/WebP inputs supported; 2/N stays 2/N after scanning and becomes 3/N only after saving; unrelated key excluded')

  await scan(a, 'p04')
  const filesBeforeRace = (await files(runtime.uploadDir)).length
  const races = await Promise.all([jpeg, png, webp, jpeg].map((bytes) => uploadFile(baseUrl, a, 'p04', bytes)))
  for (const result of races) { assert.equal(result.status, 200); assert.equal(result.payload.data.completedCount, 4) }
  const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM checkins WHERE user_id = ? AND point_key = ?', [aUser.id, 'p04'])
  assert.equal(Number(rows[0].count), 1)
  assert.equal((await files(runtime.uploadDir)).length, filesBeforeRace + 1)
  await noTemporaryFiles(runtime.uploadDir)
  ok('A2: four concurrent multipart requests produce exactly one MySQL record and one winning photo; redundant files removed')

  await scan(a, 'p05')
  activity.enabled = false
  try {
    await checkError(uploadFile(baseUrl, a, 'p05', jpeg), 409, 'ACTIVITY_DISABLED')
    assert.equal((await progress(a)).completedCount, 4)
    assert.equal((await photo(baseUrl, a, 'p01')).status, 200)
  } finally { activity.enabled = true }
  const persistedDirectory = runtime.uploadDir
  const blockingFile = path.join(directory, 'not-a-directory')
  await fs.writeFile(blockingFile, 'A2 storage failure test only')
  runtime.uploadDir = blockingFile
  try {
    const failure = await uploadFile(baseUrl, a, 'p05', jpeg)
    assert.equal(failure.status, 500); assert.equal(failure.payload.error.code, 'UPLOAD_FAILED')
  } finally { runtime.uploadDir = persistedDirectory }
  assert.equal((await progress(a)).completedCount, 4)
  ok('A2: activity closure and actual filesystem failure cannot save new photos; existing progress/photos remain readable')

  const filesBeforeFailure = await files(runtime.uploadDir)
  // Real MySQL-triggered failure in this test invocation's random database, not a fake table/pool.
  await pool.query("CREATE TRIGGER a2_reject_insert BEFORE INSERT ON checkins FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A2 isolated INSERT failure'")
  try { await checkError(uploadFile(baseUrl, a, 'p05', jpeg), 500, 'UPLOAD_FAILED') }
  finally { await pool.query('DROP TRIGGER a2_reject_insert') }
  assert.deepEqual(await files(runtime.uploadDir), filesBeforeFailure)
  assert.equal((await progress(a)).completedCount, 4)
  // Abort the real backend request, not Vite's forwarding connection.
  await interruptedUpload('http://127.0.0.1:3000', a)
  await noTemporaryFiles(runtime.uploadDir)
  assert.equal((await progress(a)).completedCount, 4)
  ok('A2: real MySQL INSERT rejection and interrupted HTTP upload clean request files and never increment completion')

  const bRecord = await findCheckin(pool, bUser.id, 'p01')
  await fs.rm(path.join(runtime.uploadDir, bRecord.photo_path)) // Only this test's generated photo.
  const missing = await photo(baseUrl, b, 'p01')
  assert.equal(missing.status, 410); assert.equal(missing.payload.error.code, 'PHOTO_MISSING')
  assert.equal((await progress(b)).completedCount, 1)
  assert.equal((await uploadFile(baseUrl, b, 'p01', png)).status, 200)
  await assert.rejects(fs.stat(path.join(runtime.uploadDir, bRecord.photo_path)), { code: 'ENOENT' })
  assert.equal((await uploadFile(baseUrl, a, 'p05', jpeg)).payload.data.allCompleted, true)
  assert.equal((await progress(a)).claimedAt, null)
  const expired = browser(baseUrl)
  await oauth(expired, 'a2-user-b')
  const sid = decodeURIComponent(expired.cookie.slice('changqi.sid='.length)).slice(2).split('.')[0]
  await pool.execute('UPDATE sessions SET expires = 1 WHERE session_id = ?', [sid])
  assert.equal((await photo(baseUrl, expired, 'p01')).status, 401)
  ok('A2: cleaned photo returns explicit 410 without undoing progress or permitting replacement; expired session cannot read it; no claim writes')

  const ui = browser(baseUrl)
  await oauth(ui, 'a2-browser')
  const uiUser = await findOrCreateUser(pool, 'simulated-a2-browser')
  return { cookie: ui.cookie, otherCookie: b.cookie, samplePath, pngPath, badPath, directory,
    checkBrowserSaved: async (keys) => {
      assert.deepEqual((await progress(ui)).completedKeys, keys)
      for (const key of keys) assert.equal((await photo(baseUrl, ui, key)).status, 200)
      const [uiRows] = await pool.execute('SELECT point_key FROM checkins WHERE user_id = ?', [uiUser.id])
      assert.equal(uiRows.length, keys.length)
      await noTemporaryFiles(runtime.uploadDir)
    }
  }
}

export async function checkA2Restart({ start, stop, browser, directory, pool, ok }) {
  const jpeg = await fs.readFile(path.join(directory, 'photo-fixtures', 'photograph.jpg'))
  let baseUrl = await start()
  const client = browser(baseUrl)
  assert.equal((await client.request('/api/dev/login', { body: { identity: 'visitor-a' } })).status, 200)
  assert.equal((await client.request('/api/scan', { body: { result: 'http://localhost:3000/q/p02' } })).status, 200)
  const uploaded = await uploadFile(baseUrl, client, 'p02', jpeg)
  assert.equal(uploaded.status, 200)
  const before = (await client.request('/api/me')).payload.data
  const beforePhoto = (await photo(baseUrl, client, 'p02')).bytes
  const owner = await findOrCreateUser(pool, 'development:visitor-a')
  const beforeRow = await findCheckin(pool, owner.id, 'p02')
  assert.ok(beforeRow)
  await stop()
  baseUrl = await start()
  const restored = browser(baseUrl); restored.cookie = client.cookie
  assert.deepEqual((await restored.request('/api/me')).payload.data, before)
  const restoredPhoto = await photo(baseUrl, restored, 'p02')
  assert.equal(restoredPhoto.status, 200); assert.deepEqual(restoredPhoto.bytes, beforePhoto)
  assert.deepEqual(await findCheckin(pool, owner.id, 'p02'), beforeRow)
  await stop()
  ok('A2: ACTUAL server/index.js process stop/restart restores original MySQL session, saved photograph bytes and completed progress')
}
