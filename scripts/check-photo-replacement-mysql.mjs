import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from 'mysql2/promise'
import { createApp } from '../server/app.js'
import { createDatabasePool } from '../server/db.js'
import { findOrCreateUser } from '../server/identity.js'
import { replacePhotoRecord } from '../server/photo-replacement.js'
import { markClaimed } from '../server/claims.js'
import { processPhoto } from '../server/photos.js'
import { applyPhotoRevision } from '../db/migrations/001-photo-revision.mjs'
import { uploadFile } from './check-a2-mysql.mjs'

export async function putPhoto(baseUrl, client, pointKey, bytes, expectedRevision, replacementId = randomUUID(), extra = {}) {
  const body = new FormData()
  body.append('expectedRevision', expectedRevision); body.append('replacementId', replacementId)
  if (bytes !== null) body.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'replacement.jpg')
  if (extra.field) body.append(extra.field, 'not-an-identity')
  const response = await fetch(`${baseUrl}/api/me/photos/${pointKey}`, { method: 'PUT', headers: { cookie: client.cookie, ...extra.headers }, body, signal: AbortSignal.timeout(30000) })
  return { status: response.status, payload: await response.json() }
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const bind = (object, property) => typeof object[property] === 'function' ? object[property].bind(object) : object[property]

export async function checkPhotoReplacementMysql({ pool, settings, activity, runtime, sessionMiddleware, baseUrl, directory, browser, oauth, ok }) {
  const jpeg = await fs.readFile(path.join(directory, 'photo-fixtures', 'photograph.jpg'))
  const png = await fs.readFile(path.join(directory, 'photo-fixtures', 'second.png'))
  const read = async client => (await client.request('/api/me/photos')).payload.data
  const progress = async client => (await client.request('/api/me')).payload.data
  const record = async (user, key = 'p01') => (await pool.execute('SELECT * FROM checkins WHERE user_id = ? AND point_key = ?', [user.id, key]))[0][0]
  const files = async () => (await fs.readdir(runtime.uploadDir)).filter(name => name.endsWith('.jpg')).sort()
  const noTemp = async () => assert.deepEqual(await fs.readdir(path.join(runtime.uploadDir, '.tmp')), [])
  const make = async (name, count = 2, bytes = jpeg) => {
    const client = browser(baseUrl), code = `photo-test-${name}`
    await oauth(client, code)
    const user = await findOrCreateUser(pool, `simulated-${code}`)
    for (const point of activity.points.slice(0, count)) {
      await client.request('/api/scan', { body: { result: `${runtime.publicOrigin}/q/${point.key}` } })
      assert.equal((await uploadFile(baseUrl, client, point.key, bytes)).status, 200)
    }
    await oauth(client, code) // No scannedPointKey: replacement must not need one.
    return { client, user }
  }
  const invariants = async ({ user, client }) => ({ progress: await progress(client), rows: (await pool.execute('SELECT id, user_id, point_key, created_at FROM checkins WHERE user_id = ? ORDER BY id', [user.id]))[0], user: (await pool.execute('SELECT id, claim_code, claimed_at, claim_source FROM users WHERE id = ?', [user.id]))[0], claimedCount: (await pool.query('SELECT COUNT(*) AS n FROM users WHERE claimed_at IS NOT NULL'))[0][0].n })
  const a = await make('owner'), b = await make('other', 1, png), anon = browser(baseUrl)
  assert.equal((await anon.request('/api/me/photos')).status, 401)
  assert.equal((await putPhoto(baseUrl, anon, 'p01', png, 'initial')).status, 401)
  const metadata = await read(a.client)
  assert.equal(metadata.userLabel, (await progress(a.client)).userLabel)
  assert.deepEqual(metadata.photos.map(photo => photo.pointKey), [...activity.points].sort((a, b) => a.displayOrder - b.displayOrder).map(point => point.key))
  assert.equal(metadata.photos.filter(photo => photo.canReplace).length, 2)
  assert.doesNotMatch(JSON.stringify(metadata), /photo_path|openid|claim_code|claimUrl|\.jpg/)
  assert.equal((await putPhoto(baseUrl, a.client, 'p03', png, 'initial')).payload.error.code, 'PHOTO_NOT_FOUND')
  assert.equal((await uploadFile(baseUrl, a.client, 'p03', jpeg)).payload.error.code, 'PLEASE_SCAN')
  for (const extra of [{ field: 'userId' }, { field: 'openid' }, { field: 'photo_path' }]) assert.equal((await putPhoto(baseUrl, a.client, 'p01', png, 'initial', randomUUID(), extra)).status, 400)
  assert.equal((await putPhoto(baseUrl, a.client, 'p01', png, 'initial', randomUUID(), { headers: { origin: 'https://other.invalid' } })).status, 403)
  assert.equal((await putPhoto(baseUrl, a.client, 'p01', png, 'initial', randomUUID(), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await putPhoto(baseUrl, b.client, 'p01', png, 'initial', randomUUID(), { headers: { 'x-photo-owner': metadata.userLabel } })).payload.error.code, 'PHOTO_OWNER_CHANGED')
  const anonymousState = await anon.request(`/api/r/${a.user.claim_code}`)
  assert.deepEqual(Object.keys(anonymousState.payload.data).sort(), ['allCompleted', 'claimedAt', 'completedCount', 'totalCount', 'userLabel'])
  assert.equal((await anon.request(`/api/r/${a.user.claim_code}/photos`)).status, 404)
  ok('PHOTO: session-only metadata/PUT, dynamic ordered N, no identity/path fields or anonymous photo privileges; missing point cannot be created and first POST still needs scan')

  const before = await invariants(a), old = await record(a.user), oldBytes = await fs.readFile(path.join(runtime.uploadDir, old.photo_path))
  const replacementId = randomUUID()
  assert.equal((await putPhoto(baseUrl, a.client, 'p01', png, old.photo_revision, replacementId)).status, 200)
  const changed = await record(a.user)
  assert.equal(changed.photo_revision, replacementId); assert.notEqual(changed.photo_path, old.photo_path)
  assert.notEqual(changed.photo_path.slice(0, 32), replacementId.replaceAll('-', ''))
  assert.deepEqual(await invariants(a), before)
  const byteResponse = await fetch(`${baseUrl}/api/me/photos/p01?revision=${replacementId}&owner=${metadata.userLabel}`, { headers: { cookie: a.client.cookie } })
  assert.equal(byteResponse.status, 200); assert.equal(byteResponse.headers.get('x-photo-revision'), replacementId)
  assert.equal(byteResponse.headers.get('x-photo-owner'), metadata.userLabel); assert.match(byteResponse.headers.get('cache-control'), /no-store/)
  assert.deepEqual(Buffer.from(await byteResponse.arrayBuffer()), await fs.readFile(path.join(runtime.uploadDir, changed.photo_path)))
  assert.equal((await fetch(`${baseUrl}/api/me/photos/p01?revision=initial`, { headers: { cookie: a.client.cookie } })).status, 409)
  const beforeRetry = await files()
  assert.equal((await putPhoto(baseUrl, a.client, 'p01', Buffer.from('not decoded for same successful ID'), 'initial', replacementId)).status, 200)
  assert.equal((await uploadFile(baseUrl, a.client, 'p01', jpeg)).status, 200)
  assert.deepEqual(await record(a.user), changed); assert.deepEqual(await files(), beforeRetry)
  assert.notDeepEqual(await fs.readFile(path.join(runtime.uploadDir, changed.photo_path)), oldBytes)
  await assert.rejects(fs.stat(path.join(runtime.uploadDir, old.photo_path)), { code: 'ENOENT' })
  ok('PHOTO: no-rescan 2/N replacement changes only path/revision; original row/time/code/count stay fixed; exact revision bytes; same-ID and ordinary POST retries never overwrite')

  const baseline = await record(a.user), baselineFiles = await files()
  for (const [bytes, expected] of [[Buffer.from('damaged'), 415], [null, 400], [Buffer.alloc(15 * 1024 * 1024 + 1), 413]]) assert.equal((await putPhoto(baseUrl, a.client, 'p01', bytes, baseline.photo_revision)).status, expected)
  assert.equal((await putPhoto(baseUrl, a.client, 'p01', png, 'initial')).status, 409)
  assert.equal((await putPhoto(baseUrl, a.client, 'p01', png, '../file')).status, 400)
  const originalDir = runtime.uploadDir, blocking = path.join(directory, 'photo-replace-storage-blocker')
  await fs.writeFile(blocking, 'test only')
  runtime.uploadDir = blocking
  try { assert.equal((await putPhoto(baseUrl, a.client, 'p01', png, baseline.photo_revision)).payload.error.code, 'REPLACEMENT_FAILED') }
  finally { runtime.uploadDir = originalDir }
  await pool.query("CREATE TRIGGER photo_reject_update BEFORE UPDATE ON checkins FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated replacement SQL failure'")
  try { assert.equal((await putPhoto(baseUrl, a.client, 'p01', jpeg, baseline.photo_revision)).payload.error.code, 'REPLACEMENT_FAILED') }
  finally { await pool.query('DROP TRIGGER photo_reject_update') }
  assert.deepEqual(await record(a.user), baseline); assert.deepEqual(await files(), baselineFiles); await noTemp()
  ok('PHOTO: actual decode/size/storage and MySQL UPDATE failures preserve old record/photo; conflicts and malformed input do not write; request files cleaned')

  const raceIds = [randomUUID(), randomUUID()]
  const race = await Promise.all(raceIds.map(id => putPhoto(baseUrl, a.client, 'p01', jpeg, baseline.photo_revision, id)))
  assert.deepEqual(race.map(result => result.status).sort(), [200, 409])
  const winner = await record(a.user)
  assert.equal(winner.photo_revision, raceIds[race.findIndex(result => result.status === 200)])
  const sameId = randomUUID(), raceFiles = await files()
  assert.ok((await Promise.all([1, 2, 3].map(() => putPhoto(baseUrl, a.client, 'p01', png, winner.photo_revision, sameId)))).every(result => result.status === 200))
  assert.equal((await record(a.user)).photo_revision, sameId)
  assert.equal((await files()).length, raceFiles.length); await noTemp()
  assert.deepEqual(await invariants(a), before)
  ok('PHOTO: two same-version replacements yield one winner/one conflict; concurrent same-ID retries save only one photo and never change progress')

  // Real MySQL commits, with only acknowledgement/read failures injected at the connection boundary.
  async function withFault(mode, callback) {
    let committed = false
    const faultPool = new Proxy(pool, { get(target, prop) {
      if (prop === 'execute') return async (sql, args) => {
        if (committed && mode === 'commit-and-read-lost' && sql.startsWith('SELECT photo_path, photo_revision, created_at')) throw new Error('SIMULATED reconciliation read loss')
        return target.execute(sql, args)
      }
      if (prop === 'getConnection') return async () => {
        const connection = await target.getConnection()
        return new Proxy(connection, { get(current, field) {
          if (field === 'commit') return async () => { if (mode !== 'commit-not-sent') await current.commit(); committed = true; throw new Error('SIMULATED COMMIT acknowledgement loss') }
          return bind(current, field)
        } })
      }
      return bind(target, prop)
    } })
    const faultRuntime = { ...runtime }
    const server = http.createServer(createApp({ pool: faultPool, runtime: faultRuntime, activityConfig: activity, sessionMiddleware }))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    faultRuntime.publicOrigin = `http://127.0.0.1:${server.address().port}`
    try { await callback(faultRuntime.publicOrigin) } finally { await new Promise(resolve => server.close(resolve)) }
  }
  for (const mode of ['commit-ack-lost', 'commit-and-read-lost', 'commit-not-sent']) {
    const row = await record(a.user), id = randomUUID(), priorFiles = await files()
    await withFault(mode, async origin => {
      const result = await putPhoto(origin, a.client, 'p01', jpeg, row.photo_revision, id)
      assert.equal(result.status, mode === 'commit-ack-lost' ? 200 : 503)
      if (result.status === 503) assert.equal(result.payload.error.code, 'REPLACEMENT_UNCERTAIN')
    })
    const current = await record(a.user)
    if (mode === 'commit-not-sent') assert.equal(current.photo_revision, row.photo_revision)
    else assert.equal(current.photo_revision, id)
    if (mode !== 'commit-ack-lost') {
      assert.ok((await files()).includes(row.photo_path), 'Unknown commit must retain old file')
      assert.equal((await files()).length, priorFiles.length + 1, 'Unknown commit must retain possibly referenced new file')
    }
    assert.equal((await putPhoto(baseUrl, a.client, 'p01', jpeg, row.photo_revision, id)).status, 200)
    assert.equal((await record(a.user)).photo_revision, id)
    await noTemp()
  }
  ok('PHOTO: actual COMMIT with lost ACK recovers; COMMIT+read loss and unsent COMMIT retain both files and return unknown; same-ID retry resolves without false success')

  const cleanupOld = await record(a.user), rm = fs.rm
  fs.rm = async (filename, options) => {
    if (filename === path.join(runtime.uploadDir, cleanupOld.photo_path)) throw Object.assign(new Error('SIMULATED old-file permission failure'), { code: 'EACCES' })
    return rm(filename, options)
  }
  try { assert.equal((await putPhoto(baseUrl, a.client, 'p01', png, cleanupOld.photo_revision)).status, 200) }
  finally { fs.rm = rm }
  assert.ok((await files()).includes(cleanupOld.photo_path)); assert.notEqual((await record(a.user)).photo_path, cleanupOld.photo_path)
  ok('PHOTO: old-file cleanup failure is recorded as pending cleanup, not a false failed replacement')

  // Deterministic lock-order races on real independent connections, for each claim source.
  async function heldLockPool() {
    let enter, release
    const acquired = new Promise(resolve => { enter = resolve }), gate = new Promise(resolve => { release = resolve })
    const wrapped = new Proxy(pool, { get(target, prop) {
      if (prop !== 'getConnection') return bind(target, prop)
      return async () => {
        const connection = await target.getConnection()
        return new Proxy(connection, { get(current, field) {
          if (field !== 'execute') return bind(current, field)
          return async (sql, args) => { const result = await current.execute(sql, args); if (sql.includes('FROM users WHERE id = ? FOR UPDATE')) { enter(); await gate }; return result }
        } })
      }
    } })
    return { wrapped, acquired, release }
  }
  for (const source of ['self', 'staff']) for (const first of ['photo', 'claim']) {
    const visitor = await make(`${source}-${first}`, activity.points.length), original = await record(visitor.user), id = randomUUID()
    const filename = `${randomBytes(16).toString('hex')}.jpg`
    await processPhoto(path.join(directory, 'photo-fixtures', 'second.png'), path.join(runtime.uploadDir, filename))
    const operation = { userId: visitor.user.id, pointKey: 'p01', expectedRevision: original.photo_revision, replacementId: id, filename, activity }
    const countBefore = (await pool.query('SELECT COUNT(*) AS n FROM users WHERE claimed_at IS NOT NULL'))[0][0].n
    const gate = await heldLockPool()
    const primary = first === 'photo' ? replacePhotoRecord(gate.wrapped, operation) : markClaimed(gate.wrapped, visitor.user.id, source, activity, runtime.publicOrigin)
    await gate.acquired
    let secondFinished = false
    const secondary = (first === 'photo' ? markClaimed(pool, visitor.user.id, source, activity, runtime.publicOrigin) : replacePhotoRecord(pool, operation)).then(value => ({ value }), error => ({ error })).finally(() => { secondFinished = true })
    await delay(80); assert.equal(secondFinished, false, 'Second mutation waits on the same users lock')
    gate.release(); await primary
    const result = await secondary, after = await record(visitor.user)
    if (first === 'photo') { assert.ok(result.value.claimedAt); assert.equal(after.photo_revision, id) }
    else { assert.equal(result.error.code, 'ALREADY_CLAIMED'); assert.equal(after.photo_path, original.photo_path) }
    const claimedBeforeRepeat = (await pool.execute('SELECT claimed_at, claim_source FROM users WHERE id = ?', [visitor.user.id]))[0][0]
    await markClaimed(pool, visitor.user.id, source === 'self' ? 'staff' : 'self', activity, runtime.publicOrigin)
    assert.deepEqual((await pool.execute('SELECT claimed_at, claim_source FROM users WHERE id = ?', [visitor.user.id]))[0][0], claimedBeforeRepeat)
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM users WHERE claimed_at IS NOT NULL'))[0][0].n), Number(countBefore) + 1)
    assert.equal((await putPhoto(baseUrl, visitor.client, 'p01', jpeg, after.photo_revision)).payload.error.code, 'ALREADY_CLAIMED')
    assert.equal((await read(visitor.client)).photos.some(photo => photo.canReplace), false)
  }
  ok('PHOTO: real users row locks coordinate both self/staff orders; claim-first refuses replacement, photo-first allows subsequent claim; first time/source remain unchanged')

  const complete = await make('full', activity.points.length), fullBefore = await invariants(complete)
  const fullId = randomUUID()
  assert.equal((await putPhoto(baseUrl, complete.client, 'p01', png, 'initial', fullId)).status, 200)
  assert.deepEqual(await invariants(complete), fullBefore)
  activity.enabled = false
  try {
    assert.equal((await putPhoto(baseUrl, complete.client, 'p01', jpeg, fullId)).payload.error.code, 'ACTIVITY_DISABLED')
    assert.equal((await putPhoto(baseUrl, complete.client, 'p01', png, 'initial', fullId)).status, 200, 'Same completed operation can be confirmed after closure')
    assert.equal((await read(complete.client)).photos.some(photo => photo.canReplace), false)
    assert.equal((await fetch(`${baseUrl}/api/me/photos/p01?revision=${fullId}`, { headers: { cookie: complete.client.cookie } })).status, 200)
  } finally { activity.enabled = true }
  ok('PHOTO: N/N replacement keeps all invariants; closed activity allows reads and exact operation confirmation, but no new replacement')

  // Upgrade a separate legacy schema, not the current harness or any existing user database.
  const legacyName = `changqi_photo_legacy_${randomBytes(6).toString('hex')}`
  const admin = await mysql.createConnection(settings)
  let legacyPool, legacyConnection, createdLegacy = false
  const legacyOldName = `${randomBytes(16).toString('hex')}.jpg`
  await fs.writeFile(path.join(runtime.uploadDir, legacyOldName), jpeg)
  try {
    await admin.query(`CREATE DATABASE \`${legacyName}\``)
    createdLegacy = true
    legacyConnection = await mysql.createConnection({ ...settings, database: legacyName, multipleStatements: true })
    const schema = (await fs.readFile('db/schema.sql', 'utf8')).replace(/^.*photo_revision.*\r?\n/m, '')
    assert.doesNotMatch(schema, /photo_revision/)
    await legacyConnection.query(schema)
    await legacyConnection.execute('INSERT INTO users (openid, claim_code) VALUES (?, ?)', ['legacy-photo-test', randomBytes(16).toString('hex')])
    await legacyConnection.execute("INSERT INTO checkins (user_id, point_key, photo_path, created_at) VALUES (1, 'p01', ?, '2026-09-01 09:00:00')", [legacyOldName])
    const legacyBefore = (await legacyConnection.query('SELECT * FROM checkins'))[0][0]
    await applyPhotoRevision(legacyConnection); await applyPhotoRevision(legacyConnection)
    const migrated = (await legacyConnection.query('SELECT * FROM checkins'))[0][0]
    assert.equal(migrated.photo_revision, 'initial')
    const { photo_revision: _revision, ...rest } = migrated; assert.deepEqual(rest, legacyBefore)
    legacyPool = createDatabasePool({ ...settings, database: legacyName })
    assert.deepEqual(await fs.readFile(path.join(runtime.uploadDir, migrated.photo_path)), jpeg)
    const id = randomUUID(), filename = `${randomBytes(16).toString('hex')}.jpg`
    await processPhoto(path.join(directory, 'photo-fixtures', 'second.png'), path.join(runtime.uploadDir, filename))
    await replacePhotoRecord(legacyPool, { userId: '1', pointKey: 'p01', expectedRevision: 'initial', replacementId: id, filename, activity })
    assert.notDeepEqual(await fs.readFile(path.join(runtime.uploadDir, filename)), jpeg)
    await applyPhotoRevision(legacyConnection)
    assert.equal((await legacyConnection.query('SELECT photo_revision FROM checkins'))[0][0].photo_revision, id)
  } finally {
    if (legacyPool) await legacyPool.end()
    if (legacyConnection) await legacyConnection.end()
    if (createdLegacy) await admin.query(`DROP DATABASE \`${legacyName}\``)
    await admin.end()
  }
  ok('PHOTO: old populated schema upgrades additively, repeated migration preserves row/time and later replacement revision; empty schema already exercised through db:schema')

  const ui = await make('ui', activity.points.length), missing = await make('missing', activity.points.length)
  const missingRow = await record(missing.user)
  await fs.rm(path.join(runtime.uploadDir, missingRow.photo_path))
  const authA = await make('auth-a', activity.points.length), authB = await make('auth-b', activity.points.length, png)
  // Separate observer sessions remain usable when the actual browser regenerates its OAuth session.
  const authBrowser = browser(baseUrl), authOtherBrowser = browser(baseUrl)
  await oauth(authBrowser, 'photo-test-auth-a'); await oauth(authOtherBrowser, 'photo-test-auth-b')
  const auth = { cookie: authBrowser.cookie, otherCookie: authOtherBrowser.cookie,
    ownerA: (await progress(authA.client)).userLabel, ownerB: (await progress(authB.client)).userLabel,
    read: () => read(authA.client), invariant: () => invariants(authA),
    digest: async () => digest(await fs.readFile(path.join(runtime.uploadDir, (await record(authA.user)).photo_path))),
    otherDigest: async () => digest(await fs.readFile(path.join(runtime.uploadDir, (await record(authB.user)).photo_path))),
    claim: () => anon.request(`/api/r/${authA.user.claim_code}/claim`, { body: {} }) }
  return { auth, cookie: ui.client.cookie, otherCookie: b.client.cookie, missingCookie: missing.client.cookie,
    samplePath: path.join(directory, 'photo-fixtures', 'photograph.jpg'), pngPath: path.join(directory, 'photo-fixtures', 'second.png'), badPath: path.join(directory, 'photo-fixtures', 'damaged.jpg'),
    readUi: () => read(ui.client), uiProgress: () => progress(ui.client), uiInvariant: () => invariants(ui),
    changeUi: async () => { const row = await record(ui.user), otherRow = await record(b.user); const isPng = digest(await fs.readFile(path.join(runtime.uploadDir, row.photo_path))) === digest(await fs.readFile(path.join(runtime.uploadDir, otherRow.photo_path))); const id = randomUUID(); assert.equal((await putPhoto(baseUrl, ui.client, 'p01', isPng ? jpeg : png, row.photo_revision, id)).status, 200); return id },
    imageDigest: async (which = 'ui') => { const row = await record(which === 'ui' ? ui.user : b.user); return digest(await fs.readFile(path.join(runtime.uploadDir, row.photo_path))) },
    claimUi: () => anon.request(`/api/r/${ui.user.claim_code}/claim`, { body: {} }),
    holdUi: async () => { const connection = await pool.getConnection(); await connection.beginTransaction(); await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [ui.user.id]); return async () => { await connection.rollback(); connection.release() } }
  }
}

export async function checkPhotoReplacementRestart({ start, stop, browser, directory, ok }) {
  let origin = await start(); const client = browser(origin)
  await client.request('/api/dev/login', { body: { identity: 'visitor-a' } })
  const before = (await client.request('/api/me')).payload.data
  const inventory = (await client.request('/api/me/photos')).payload.data
  const old = inventory.photos.find(photo => photo.pointKey === 'p02')
  const id = randomUUID(), bytes = await fs.readFile(path.join(directory, 'photo-fixtures', 'second.png'))
  assert.equal((await putPhoto(origin, client, 'p02', bytes, old.revision, id)).status, 200)
  const saved = Buffer.from(await (await fetch(`${origin}/api/me/photos/p02?revision=${id}`, { headers: { cookie: client.cookie } })).arrayBuffer())
  await stop(); origin = await start()
  const restored = browser(origin); restored.cookie = client.cookie
  assert.deepEqual((await restored.request('/api/me')).payload.data, before)
  assert.equal((await restored.request('/api/me/photos')).payload.data.photos.find(photo => photo.pointKey === 'p02').revision, id)
  const result = await fetch(`${origin}/api/me/photos/p02?revision=${id}`, { headers: { cookie: client.cookie } })
  assert.equal(result.status, 200); assert.deepEqual(Buffer.from(await result.arrayBuffer()), saved)
  await stop()
  ok('PHOTO: ACTUAL application process restart preserves replacement revision/bytes, session and unchanged progress/claim code')
}
