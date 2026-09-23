import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { createApp } from '../server/app.js'
import { createDatabasePool } from '../server/db.js'
import { findOrCreateUser } from '../server/identity.js'
import { uploadFile } from './check-a2-mysql.mjs'

export async function checkA3Mysql({ pool, settings, activity, runtime, baseUrl, directory, browser, oauth, ok }) {
  const anonymous = browser(baseUrl)
  const jpeg = await fs.readFile(path.join(directory, 'photo-fixtures', 'photograph.jpg'))
  const claimedRow = async (id) => {
    const [rows] = await pool.execute('SELECT claimed_at, claim_source FROM users WHERE id = ?', [id])
    return rows[0]
  }
  const countClaimed = async () => Number((await pool.query('SELECT COUNT(*) AS n FROM users WHERE claimed_at IS NOT NULL'))[0][0].n)
  const credential = `Basic ${Buffer.from(`${runtime.statsUser}:${runtime.statsPassword}`).toString('base64')}`
  const stats = () => anonymous.request('/stats', { headers: { authorization: credential } })
  const makeVisitor = async (name, complete = true) => {
    const client = browser(baseUrl)
    await oauth(client, name)
    const user = await findOrCreateUser(pool, `simulated-${name}`)
    if (complete) {
      for (const point of activity.points) {
        assert.equal((await client.request('/api/scan', { body: { result: `${runtime.publicOrigin}/q/${point.key}` } })).status, 200)
        assert.equal((await uploadFile(baseUrl, client, point.key, jpeg)).status, 200)
      }
      assert.equal((await client.request('/api/me')).payload.data.allCompleted, true)
    }
    return { client, user, route: `/api/r/${user.claim_code}`, page: `/r/${user.claim_code}` }
  }
  assert.equal(await countClaimed(), 0, 'A1/A2 must not write claims')
  const notLogged = await anonymous.request('/api/me/claim', { body: {} })
  assert.equal(notLogged.status, 401); assert.equal(notLogged.payload.error.code, 'NEED_LOGIN')
  const incomplete = await makeVisitor('a3-incomplete', false)
  // Unrelated history does not satisfy any required point.
  await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path) VALUES (?, ?, ?)', [incomplete.user.id, 'a3-retired', 'TEST-NO-PHOTO'])
  for (const [client, route] of [[incomplete.client, '/api/me/claim'], [anonymous, `${incomplete.route}/claim`]]) {
    const result = await client.request(route, { body: {} })
    assert.equal(result.status, 409); assert.equal(result.payload.error.code, 'NOT_COMPLETED')
  }
  assert.equal((await incomplete.client.request('/api/me')).payload.data.claimUrl, null)
  assert.equal(await countClaimed(), 0)
  ok('A3: own claim requires login, both paths reject incomplete progress, historical keys never unlock a claim')

  const a = await makeVisitor('a3-a'), b = await makeVisitor('a3-b')
  for (const code of ['missing', 'a'.repeat(31), a.user.claim_code.toUpperCase(), '0'.repeat(32)]) {
    const invalid = await anonymous.request(`/api/r/${code}`)
    assert.equal(invalid.status, 404); assert.equal(invalid.payload.error.code, 'INVALID_CLAIM_CODE')
  }
  const beforeOpen = await claimedRow(a.user.id)
  for (const client of [anonymous, b.client]) {
    const publicState = await client.request(a.route)
    assert.equal(publicState.status, 200)
    assert.equal(publicState.headers.get('set-cookie'), null)
    assert.deepEqual(Object.keys(publicState.payload.data).sort(), ['allCompleted', 'claimedAt', 'completedCount', 'totalCount', 'userLabel'])
    assert.doesNotMatch(publicState.text, /openid|photo|claimUrl|claim_code|claim_source|completedKeys/i)
    assert.equal((await client.request(a.page)).status, 200)
  }
  assert.deepEqual(await claimedRow(a.user.id), beforeOpen)
  assert.equal(await countClaimed(), 0)
  assert.equal((await a.client.request('/api/scan', { body: { result: `${runtime.publicOrigin}${a.page}` } })).payload.error.code, 'INVALID_QR')
  ok('A3: bearer links are read-only on GET, ignore another visitor cookie, disclose only public fields, and cannot be point codes')

  const unauthedStats = await anonymous.request('/stats')
  assert.equal(unauthedStats.status, 401); assert.match(unauthedStats.headers.get('www-authenticate'), /Basic/)
  const badStats = await anonymous.request('/stats', { headers: { authorization: `Basic ${Buffer.from('wrong:DO-NOT-ECHO').toString('base64')}` } })
  assert.equal(badStats.status, 401); assert.doesNotMatch(badStats.text, /DO-NOT-ECHO|data-stats-count/)
  assert.match((await stats()).text, /data-stats-count>0</)
  assert.equal((await anonymous.request('/api/stats')).status, 404)
  assert.equal((await anonymous.request('/stats/anything')).status, 401)
  assert.doesNotMatch((await anonymous.request('/api/activity')).text, new RegExp(runtime.statsPassword))
  ok('A3: fixed Basic Auth protects all statistics paths; zero is shown only after a successful real SQL query')

  const self = await a.client.request('/api/me/claim', { body: {} })
  assert.equal(self.status, 200); assert.match(self.payload.data.claimedAt, /\+08:00$/)
  const staff = await anonymous.request(`${b.route}/claim`, { body: {} })
  assert.equal(staff.status, 200)
  assert.equal((await claimedRow(a.user.id)).claim_source, 'self')
  assert.equal((await claimedRow(b.user.id)).claim_source, 'staff')
  assert.equal(await countClaimed(), 2)
  assert.match((await stats()).text, /data-stats-count>2</)
  ok('A3: two actual photo-complete users claim through self/staff; isolated MySQL and protected statistics both report exactly 2')

  const firstA = await claimedRow(a.user.id), firstB = await claimedRow(b.user.id)
  await delay(1050)
  for (let i = 0; i < 3; i++) {
    assert.equal((await anonymous.request(`${a.route}/claim`, { body: {} })).status, 200)
    assert.equal((await b.client.request('/api/me/claim', { body: {} })).status, 200)
  }
  assert.deepEqual(await claimedRow(a.user.id), firstA); assert.deepEqual(await claimedRow(b.user.id), firstB)
  assert.equal(await countClaimed(), 2)
  const race = await makeVisitor('a3-race')
  const outcomes = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? race.client : anonymous).request(i % 2 ? '/api/me/claim' : `${race.route}/claim`, { body: {} })))
  assert.ok(outcomes.every((result) => result.status === 200))
  assert.equal(new Set(outcomes.map((result) => result.payload.data.claimedAt)).size, 1)
  const firstRace = await claimedRow(race.user.id)
  assert.ok(['self', 'staff'].includes(firstRace.claim_source))
  assert.equal(await countClaimed(), 3)
  await race.client.request('/api/me/claim', { body: {} })
  assert.deepEqual(await claimedRow(race.user.id), firstRace)
  ok('A3: repeated and 12 simultaneous self/staff requests keep the first time/source and add only one claimed identity')

  const closed = await makeVisitor('a3-closed')
  activity.enabled = false
  try {
    for (const [client, route] of [[closed.client, '/api/me/claim'], [anonymous, `${closed.route}/claim`]]) {
      const result = await client.request(route, { body: {} })
      assert.equal(result.status, 409); assert.equal(result.payload.error.code, 'ACTIVITY_DISABLED')
    }
    assert.equal((await a.client.request('/api/me/claim', { body: {} })).status, 200)
    assert.equal((await anonymous.request(`${b.route}/claim`, { body: {} })).status, 200)
    assert.equal((await closed.client.request('/api/me')).payload.data.allCompleted, true)
    assert.equal((await anonymous.request(closed.route)).status, 200)
    assert.equal((await stats()).status, 200)
  } finally { activity.enabled = true }
  assert.equal(await countClaimed(), 3)
  ok('A3: closed activity rejects first claims but existing claim confirmations, progress and statistics remain readable/idempotent')

  for (const body of [{ source: 'staff' }, { userId: a.user.id }, { claimedAt: 'forged' }]) {
    assert.equal((await closed.client.request('/api/me/claim', { body })).status, 400)
    assert.equal((await anonymous.request(`${closed.route}/claim`, { body })).status, 400)
  }
  assert.equal((await closed.client.request('/api/me/claim', { body: {}, headers: { origin: 'https://evil.test' } })).status, 403)
  assert.equal((await anonymous.request(`${closed.route}/claim`, { body: {}, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await closed.client.request('/api/me/claim')).status, 404, 'GET cannot confirm')
  const noJson = await fetch(`${baseUrl}${closed.route}/claim`, { method: 'POST', body: 'not-json' })
  assert.equal(noJson.status, 415)
  assert.equal((await anonymous.request(`/api/r/${'z'.repeat(32)}/claim`, { body: {} })).status, 404)
  assert.equal(await countClaimed(), 3)
  ok('A3: client-supplied identity/source/time, cross-origin requests, malformed codes and GET cannot write claims')

  assert.match(String(closed.user.id), /^\d+$/)
  await pool.query(`CREATE TRIGGER a3_reject_claim BEFORE UPDATE ON users FOR EACH ROW BEGIN IF NEW.id = ${closed.user.id} AND NEW.claimed_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A3 deliberate isolated test rejection'; END IF; END`)
  try {
    for (const [client, route] of [[closed.client, '/api/me/claim'], [anonymous, `${closed.route}/claim`]]) {
      const result = await client.request(route, { body: {} })
      assert.equal(result.status, 500); assert.equal(result.payload.error.code, 'SAVE_FAILED')
      assert.doesNotMatch(result.text, /TRIGGER|SQLSTATE|deliberate/)
    }
  } finally { await pool.query('DROP TRIGGER a3_reject_claim') }
  assert.equal((await claimedRow(closed.user.id)).claimed_at, null)
  assert.equal(await countClaimed(), 3)
  ok('A3: real MySQL UPDATE rejection returns SAVE_FAILED without a false claim or counter increment')

  // Real MySQL pool lifecycle failure; no fake COUNT result or in-memory database substitute.
  const endedPool = createDatabasePool(settings)
  await endedPool.query('SELECT 1'); await endedPool.end()
  const failureServer = http.createServer(createApp({ activityConfig: activity, pool: endedPool, runtime }))
  await new Promise((resolve) => failureServer.listen(0, '127.0.0.1', resolve))
  try {
    const result = await fetch(`http://127.0.0.1:${failureServer.address().port}/stats`, { headers: { authorization: credential } })
    assert.equal(result.status, 503)
    const text = await result.text()
    assert.match(text, /暂时无法读取/); assert.doesNotMatch(text, /data-stats-count|Pool is closed|password|DB_HOST/)
  } finally { await new Promise((resolve) => failureServer.close(resolve)) }
  ok('A3: an actual unavailable MySQL connection shows a statistics error, never a misleading zero')

  const uiSelf = await makeVisitor('a3-ui-self'), uiStaff = await makeVisitor('a3-ui-staff')
  return {
    selfCookie: uiSelf.client.cookie, staffCookie: uiStaff.client.cookie, incompleteCookie: incomplete.client.cookie,
    selfUrl: `${baseUrl}${uiSelf.page}`, staffUrl: `${baseUrl}${uiStaff.page}`, credential,
    assertUiClaim: async (which, expected) => {
      const current = await claimedRow(which === 'self' ? uiSelf.user.id : uiStaff.user.id)
      assert.equal(Boolean(current.claimed_at), expected)
      if (expected) assert.equal(current.claim_source, which)
    },
    countClaimed,
    outsideStaffClaim: async () => anonymous.request(`${uiStaff.route}/claim`, { body: {} })
  }
}

export async function checkA3Restart({ start, stop, browser, pool, activity, directory, ok }) {
  let origin = await start()
  const client = browser(origin)
  await client.request('/api/dev/login', { body: { identity: 'visitor-a' } })
  const jpeg = await fs.readFile(path.join(directory, 'photo-fixtures', 'photograph.jpg'))
  const existing = (await client.request('/api/me')).payload.data.completedKeys
  for (const point of activity.points.filter((point) => !existing.includes(point.key))) {
    await client.request('/api/scan', { body: { result: `http://localhost:3000/q/${point.key}` } })
    assert.equal((await uploadFile(origin, client, point.key, jpeg)).status, 200)
  }
  const result = await client.request('/api/me/claim', { body: {} })
  assert.equal(result.status, 200); assert.ok(result.payload.data.claimedAt)
  const beforeRestartState = (await client.request('/api/me')).payload.data
  assert.equal(Object.hasOwn(result.payload.data, 'scannedPointKey'), false, 'claim responses need not carry session eligibility')
  const user = await findOrCreateUser(pool, 'development:visitor-a')
  const before = (await pool.execute('SELECT claimed_at, claim_source FROM users WHERE id = ?', [user.id]))[0][0]
  await stop(); origin = await start()
  const restored = browser(origin); restored.cookie = client.cookie
  assert.deepEqual((await restored.request('/api/me')).payload.data, beforeRestartState)
  assert.equal((await browser(origin).request(`/api/r/${user.claim_code}`)).payload.data.claimedAt, result.payload.data.claimedAt)
  await restored.request('/api/me/claim', { body: {} })
  assert.deepEqual((await pool.execute('SELECT claimed_at, claim_source FROM users WHERE id = ?', [user.id]))[0][0], before)
  await stop()
  ok('A3: ACTUAL application process restart preserves the claim, first timestamp/source and anonymous bearer lookup')
}
