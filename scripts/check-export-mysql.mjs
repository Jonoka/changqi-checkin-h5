import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import mysql from 'mysql2/promise'
import sharp from 'sharp'
import { createDatabasePool } from '../server/db.js'
import { loadActivityConfig } from '../server/config.js'
import { readActivityReport } from '../server/activity-reports.js'
import { exportActivity } from '../server/activity-export.js'
import { runtimeConfig } from '../server/runtime.js'
import { createApp } from '../server/app.js'
import { replacePhotoRecord } from '../server/photo-replacement.js'
import { markClaimed } from '../server/claims.js'
import { checkStatsBrowser } from './check-stats-browser.mjs'

// Never load .env and never fall back to DB_*. UUID must belong to the operator's isolated instance.
const settings = { host: process.env.TEST_DB_HOST, port: Number(process.env.TEST_DB_PORT), user: process.env.TEST_DB_USER, password: process.env.TEST_DB_PASSWORD }
assert.ok(['127.0.0.1', '::1', 'localhost'].includes(settings.host), 'Explicit independent loopback TEST_DB_HOST required')
assert.ok(Number.isInteger(settings.port) && settings.port > 0 && settings.user && Object.hasOwn(process.env, 'TEST_DB_PASSWORD'))
assert.match(process.env.TEST_DB_SERVER_UUID || '', /^[a-f0-9-]{36}$/i, 'TEST_DB_SERVER_UUID of the verified isolated instance required')
const database = `changqi_export_test_${randomBytes(6).toString('hex')}`
const evidence = path.resolve('tmp', database)
const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'changqi-export-synthetic-'))
const uploads = path.join(privateRoot, 'source-photos'), batches = path.join(privateRoot, 'batches')
await fs.mkdir(evidence, { recursive: true }); await fs.mkdir(uploads, { mode: 0o700 }); await fs.mkdir(batches, { mode: 0o700 })
const activity = loadActivityConfig(), records = [], assertions = [], start = Date.now()
const expected = { identified: 4, participants: 3, completed: 2, claimed: 1, completedUnclaimed: 1, photoRecords: 12, claimedIncomplete: 0 }
const evidenceInfo = { syntheticOnly: true, database, node: process.version, batches: [], assertions, screenshots: null }
let admin, pool, server, created = false, peakRss = process.memoryUsage().rss
const sampleMemory = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 100).unref()
const ok = name => { assertions.push(name); console.log(`PASS ${assertions.length}: ${name}`) }
const report = (config = activity, options = {}) => readActivityReport(pool, config, { includeInventory: true, ...options })
const out = name => path.join(batches, name)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function stateDigest() {
  const [users] = await pool.query('SELECT * FROM users ORDER BY id')
  const [checkins] = await pool.query('SELECT * FROM checkins ORDER BY id')
  return digest(JSON.stringify({ users, checkins }))
}
async function newPhoto(color = '#123456') {
  const bytes = await sharp({ create: { width: 120, height: 90, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer()
  const basename = randomBytes(16).toString('hex') + '.jpg'
  await fs.writeFile(path.join(uploads, basename), bytes)
  return { basename, bytes, sha256: digest(bytes) }
}
async function runCli(args) {
  const env = { ...process.env, DB_HOST: settings.host, DB_PORT: String(settings.port), DB_USER: settings.user, DB_PASSWORD: settings.password,
    DB_NAME: database, UPLOAD_DIR: uploads, STATS_EXCLUDE_CQ_FILE: '' }
  delete env.NODE_OPTIONS; delete env.DOTENV_CONFIG_PATH
  const child = spawn(process.execPath, ['scripts/export-activity.mjs', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'exit')
  return { code, stdout, stderr, value: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null }
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (!quoted && c === ',') { row.push(cell); cell = '' }
    else if (!quoted && c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  assert.equal(quoted, false); return rows
}
async function inspectBatch(directory, expectedUsers, expectedFiles) {
  const info = JSON.parse(await fs.readFile(path.join(directory, 'export-info.json'), 'utf8'))
  assert.equal(info.selectedUsers, expectedUsers); assert.equal(info.expectedFiles, expectedFiles)
  assert.equal(info.expectedFiles, info.successfulFiles + info.exceptionalFiles)
  assert.match(info.source.fingerprint, /^[a-f0-9]{64}$/); assert.match(info.configHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(info.requiredKeys, ['p01', 'p02', 'p03', 'p04', 'p05'])
  const csvRows = parseCsv(await fs.readFile(path.join(directory, '照片清单.csv'), 'utf8'))
  const start = csvRows.findIndex(row => row[0] === '游客编号')
  const photos = csvRows.slice(start + 1)
  assert.equal(photos.length, expectedFiles)
  for (const photo of photos.filter(row => row[10] === '成功')) {
    assert.match(photo[6], /^photos\/CQ\d+\/p0[1-5]-[^/]+\.jpg$/)
    const bytes = await fs.readFile(path.join(directory, photo[6]))
    assert.equal(Number(photo[7]), bytes.length); assert.equal(photo[8], digest(bytes))
  }
  for (const name of (await fs.readdir(directory)).filter(name => /\.csv$|\.json$/.test(name))) {
    const text = await fs.readFile(path.join(directory, name), 'utf8')
    assert.doesNotMatch(text, /SYNTHETIC-OPENID|claim_code|claimCode|Cookie|DB_PASSWORD|source-photos|file:\/\//i)
    assert.equal(text.includes(privateRoot), false)
  }
  evidenceInfo.batches.push({ name: path.basename(directory), selectedUsers: info.selectedUsers, expectedFiles: info.expectedFiles, successfulFiles: info.successfulFiles, exceptionalFiles: info.exceptionalFiles, status: info.status })
  return { info, photos }
}

try {
  admin = await mysql.createConnection(settings)
  const [identity] = await admin.query('SELECT @@server_uuid AS uuid, @@bind_address AS bindAddress, VERSION() AS version')
  assert.equal(identity[0].uuid, process.env.TEST_DB_SERVER_UUID)
  assert.ok(['127.0.0.1', '::1'].includes(identity[0].bindAddress))
  evidenceInfo.mysql = identity[0].version
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true
  pool = createDatabasePool({ ...settings, database })
  for (const statement of (await fs.readFile('db/schema.sql', 'utf8')).split(';').map(text => text.trim()).filter(Boolean)) await pool.query(statement)
  const empty = await report()
  assert.deepEqual(empty.summary, { identified: 0, participants: 0, completed: 0, claimed: 0, completedUnclaimed: 0, photoRecords: 0, claimedIncomplete: 0 })
  assert.deepEqual(empty.points.map(point => point.users), [0, 0, 0, 0, 0]); assert.deepEqual(empty.daily, [])
  ok('real MySQL empty database: successful zero metrics and all zero-count sites')

  for (const id of ['1', '2', '3', '4']) await pool.execute('INSERT INTO users (id, openid, claim_code, claimed_at) VALUES (?, ?, ?, ?)', [id, `SYNTHETIC-OPENID-${id}`, randomBytes(16).toString('hex'), id === '4' ? '2026-09-25 00:00:00' : null])
  for (const [id, count] of [['2', 2], ['3', 5], ['4', 5]]) {
    for (let i = 0; i < count; i++) {
      const image = await newPhoto(), pointKey = `p0${i + 1}`
      await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path, created_at) VALUES (?, ?, ?, ?)', [id, pointKey, image.basename, i === 4 ? '2026-09-25 00:00:00' : '2026-09-24 23:59:59'])
      records.push({ id, pointKey, ...image })
    }
  }
  assert.deepEqual((await report()).summary, expected)
  assert.deepEqual((await report()).daily, [{ date: '2026-09-24', participants: 3, completed: 0, claimed: 0 }, { date: '2026-09-25', participants: 0, completed: 2, claimed: 1 }])
  await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path) VALUES (?, ?, ?), (?, ?, ?)', ['1', 'retired', 'NOT-A-PHOTO', '1', 'P01', 'NOT-A-PHOTO'])
  assert.deepEqual((await report()).summary, expected)
  const two = await report({ ...activity, points: activity.points.slice(0, 2) })
  assert.deepEqual(two.summary, { identified: 4, participants: 3, completed: 3, claimed: 1, completedUnclaimed: 2, photoRecords: 6, claimedIncomplete: 0 })
  const six = await report({ ...activity, points: [...activity.points, { ...activity.points[0], key: 'p06', name: '零人地点', displayOrder: 6 }] })
  assert.equal(six.points.at(-1).users, 0); assert.equal(six.summary.completed, 0); assert.equal(six.summary.claimedIncomplete, 1)
  await assert.rejects(report({ ...activity, points: [] }))
  ok('independent 4/3/2/1/1/12 oracle; case-sensitive historical keys ignored; variable N, zero site and cross-midnight +08 events')

  await pool.execute('INSERT INTO users (id, openid, claim_code) VALUES (?, ?, ?)', ['9007199254740993', 'SYNTHETIC-OPENID-BIGINT', randomBytes(16).toString('hex')])
  await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path) VALUES (?, ?, ?)', ['9007199254740993', 'p01', records[0].basename])
  assert.equal((await report()).users.at(-1).cq, 'CQ9007199254740993')
  const exclusionFile = path.join(privateRoot, 'confirmed-exclusions.json')
  await fs.writeFile(exclusionFile, JSON.stringify(['CQ000002', 'CQ9007199254740993']))
  const excluded = await report(activity, { exclusionFile })
  assert.deepEqual(excluded.summary, { identified: 3, participants: 2, completed: 2, claimed: 1, completedUnclaimed: 1, photoRecords: 10, claimedIncomplete: 0 })
  assert.deepEqual(excluded.exclusion, { enabled: true, matchedUsers: 2 })
  const excludedDry = await exportActivity({ pool, activityConfig: activity, uploadDir: uploads, out: out('excluded-dry'), exclusionFile, dryRun: true })
  assert.equal(excludedDry.expectedFiles, 10); assert.equal(excludedDry.selectedUsers, 2)
  await pool.execute('DELETE FROM checkins WHERE user_id = ?', ['9007199254740993']); await pool.execute('DELETE FROM users WHERE id = ?', ['9007199254740993'])
  await pool.execute("UPDATE users SET claimed_at = '2026-09-25 01:00:00' WHERE id = '1'")
  const anomaly = await report(); assert.equal(anomaly.summary.claimed, 2); assert.equal(anomaly.summary.completedUnclaimed, 1); assert.equal(anomaly.summary.claimedIncomplete, 1)
  await pool.execute("UPDATE users SET claimed_at = NULL WHERE id = '1'")
  ok('BIGINT CQ exact; explicit exclusion shared with CLI; claimed-incomplete does not subtract completed-unclaimed incorrectly')

  // Writer commits AFTER snapshot establishment but BEFORE the report's data query.
  const consistentPool = { getConnection: async () => {
    const connection = await pool.getConnection()
    return { query: async (...args) => {
      const result = await connection.query(...args)
      if (args[0] === 'SELECT NOW() AS queried_at') await pool.execute('INSERT INTO users (id, openid, claim_code) VALUES (?, ?, ?)', ['6', 'SYNTHETIC-OPENID-NEW', randomBytes(16).toString('hex')])
      return result
    }, commit: () => connection.commit(), rollback: () => connection.rollback(), release: () => connection.release(), destroy: () => connection.destroy() }
  } }
  assert.deepEqual((await readActivityReport(consistentPool, activity)).summary, expected)
  assert.equal((await report()).summary.identified, 5)
  await pool.execute("DELETE FROM users WHERE id = '6'")
  ok('real concurrent commit after START snapshot is excluded; following request sees new identity')

  const runtime = runtimeConfig({ NODE_ENV: 'test', DEV_MOCK_ENABLED: 'true', SESSION_SECRET: 'synthetic-session-secret-1234567890', UPLOAD_DIR: uploads,
    STATS_USER: 'synthetic-report', STATS_PASSWORD: 'synthetic-stats-password-123456' })
  const credential = 'Basic ' + Buffer.from(`${runtime.statsUser}:${runtime.statsPassword}`).toString('base64')
  const headers = { authorization: credential }
  server = http.createServer(createApp({ activityConfig: activity, pool, runtime }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const [type, expectedRow] of [['summary', ['参与人数', '3']], ['points', ['p05', '文笔山顶', '2']], ['daily', ['2026-09-25', '0', '2', '1']]]) {
    assert.equal((await fetch(`${origin}/stats/export/${type}.csv`)).status, 401)
    const response = await fetch(`${origin}/stats/export/${type}.csv`, { headers })
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/)
    const bytes = Buffer.from(await response.arrayBuffer()); assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191])
    const text = bytes.toString('utf8'); assert.ok(parseCsv(text).some(row => JSON.stringify(row) === JSON.stringify(expectedRow)))
    assert.doesNotMatch(text, /CQ00000|SYNTHETIC-OPENID|claim_code|photo_path/)
    await fs.writeFile(path.join(evidence, `http-${type}.csv`), bytes)
  }
  assert.equal((await fetch(`${origin}/stats/export/not-a-report.csv`, { headers })).status, 404)
  runtime.statsExclusionFile = path.join(privateRoot, 'missing-exclusions.json')
  assert.equal((await fetch(`${origin}/stats`, { headers })).status, 503)
  assert.equal((await fetch(`${origin}/stats/export/summary.csv`, { headers })).status, 503)
  runtime.statsExclusionFile = ''
  evidenceInfo.screenshots = await checkStatsBrowser({ executable: process.env.TEST_BROWSER_EXECUTABLE, directory: evidence, origin, credential })
  ok('authenticated actual CSV contents/BOM/whitelist; config errors fail503; Chrome390/1440 and manual refresh')

  const beforeExports = await stateDigest()
  await newPhoto('#abcdef'); await fs.mkdir(path.join(uploads, '.tmp')); await fs.writeFile(path.join(uploads, '.tmp', 'not-an-export.jpg'), 'temporary synthetic source')
  const dry = await runCli(['--out', out('participants'), '--scope', 'participants', '--dry-run'])
  assert.equal(dry.code, 0); assert.equal(dry.value.expectedFiles, 12); assert.equal(dry.value.selectedUsers, 3)
  await assert.rejects(fs.stat(out('participants')), error => error.code === 'ENOENT')
  await fs.writeFile(path.join(evidence, 'cli-dry-run.json'), JSON.stringify(dry.value, null, 2))
  const full = await runCli(['--out', out('participants'), '--scope', 'participants'])
  assert.equal(full.code, 0, full.stderr); assert.equal(full.value.info.successfulFiles, 12)
  const inspection = await inspectBatch(out('participants'), 3, 12)
  for (const photo of inspection.photos) {
    const source = records.find(record => `CQ${record.id.padStart(6, '0')}` === photo[0] && record.pointKey === photo[1])
    assert.equal(photo[8], source.sha256)
  }
  for (const [scope, users, photos] of [['completed', 2, 10], ['claimed', 1, 5]]) {
    const result = await exportActivity({ pool, activityConfig: activity, uploadDir: uploads, out: out(scope), scope })
    assert.equal(result.exitCode, 0); await inspectBatch(result.output, users, photos)
    assert.match(await fs.readFile(path.join(result.output, '统计汇总.csv'), 'utf8'), /"参与人数",3/)
  }
  assert.equal((await runCli(['--out', out('participants')])).code, 1)
  assert.equal((await runCli(['--out', path.join(uploads, 'forbidden')])).code, 1)
  assert.equal(await stateDigest(), beforeExports)
  for (const original of records) assert.equal(digest(await fs.readFile(path.join(uploads, original.basename))), original.sha256)
  ok('actual CLI dry-run no directory; participants/completed/claimed=12/10/5; bytes/hash exact, no orphan/tmp export, all business rows unchanged')

  let replacementRevision, replacementBytes, claimMillis, insertedAfterSnapshot = false
  const race = await exportActivity({ pool, activityConfig: activity, uploadDir: uploads, out: out('replacement-race'), hooks: {
    afterSnapshot: async () => {
      await pool.execute('INSERT INTO users (id, openid, claim_code) VALUES (?, ?, ?)', ['7', 'SYNTHETIC-OPENID-LATE', randomBytes(16).toString('hex')])
      await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path) VALUES (?, ?, ?)', ['7', 'p01', records[0].basename]); insertedAfterSnapshot = true
    },
    afterCopy: async ({ photo, before, attempt }) => {
      if (photo.userId !== '3' || photo.pointKey !== 'p01' || attempt !== 1) return
      const next = await newPhoto('#ee8833'); replacementRevision = randomUUID(); replacementBytes = next.bytes
      const saved = await replacePhotoRecord(pool, { userId: '3', pointKey: 'p01', expectedRevision: before.photo_revision, replacementId: replacementRevision, filename: next.basename, activity })
      assert.equal(saved.referenced, true)
      await fs.unlink(path.join(uploads, saved.oldPath)) // Synthetic fixture models the normal request's old-file cleanup.
    },
    beforeCopy: async ({ photo }) => {
      if (photo.userId !== '3' || photo.pointKey !== 'p02') return
      const started = Date.now()
      const claimed = await Promise.race([markClaimed(pool, '3', 'self', activity, origin), new Promise((_, reject) => setTimeout(() => reject(new Error('claim blocked by export')), 2500).unref())])
      assert.ok(claimed.claimedAt); claimMillis = Date.now() - started
    }
  } })
  assert.equal(race.exitCode, 0); assert.equal(insertedAfterSnapshot, true); assert.equal(race.info.selectedUsers, 3); assert.equal(race.info.expectedFiles, 12)
  const racing = await inspectBatch(race.output, 3, 12)
  const actual = racing.photos.find(row => row[0] === 'CQ000003' && row[1] === 'p01')
  assert.equal(actual[4], 'initial'); assert.equal(actual[5], replacementRevision); assert.equal(actual[11], '2'); assert.equal(actual[8], digest(replacementBytes))
  assert.equal(racing.photos.some(row => row[0] === 'CQ000007'), false)
  assert.equal((await report()).summary.claimed, 2)
  evidenceInfo.concurrentClaimMillis = claimMillis
  await pool.execute("DELETE FROM checkins WHERE user_id = '7'"); await pool.execute("DELETE FROM users WHERE id = '7'")
  await pool.execute("UPDATE users SET claimed_at = NULL, claim_source = NULL WHERE id = '3'")
  ok('actual committed photo replacement retries2 and records versions; late user excluded; normal claim commits during copy without snapshot lock')

  const churn = await exportActivity({ pool, activityConfig: activity, uploadDir: uploads, out: out('continuous-change'), hooks: { afterCopy: async ({ photo, before }) => {
    if (photo.userId !== '2' || photo.pointKey !== 'p01') return
    const next = await newPhoto('#995544')
    const saved = await replacePhotoRecord(pool, { userId: '2', pointKey: 'p01', expectedRevision: before.photo_revision, replacementId: randomUUID(), filename: next.basename, activity })
    await fs.unlink(path.join(uploads, saved.oldPath))
  } } })
  assert.equal(churn.exitCode, 2); assert.equal(churn.info.successfulFiles, 11); assert.equal(churn.info.exceptionalFiles, 1)
  const changing = await inspectBatch(churn.output, 3, 12)
  assert.equal(changing.photos.find(row => row[10] === 'SOURCE_CHANGED')[11], '3')
  const absent = records.find(record => record.id === '4' && record.pointKey === 'p04')
  await fs.unlink(path.join(uploads, absent.basename))
  assert.deepEqual((await report()).summary, expected)
  const missing = await exportActivity({ pool, activityConfig: activity, uploadDir: uploads, out: out('missing-file') })
  assert.equal(missing.exitCode, 2); assert.equal(missing.info.exceptionalFiles, 1); await inspectBatch(missing.output, 3, 12)
  await fs.writeFile(path.join(uploads, absent.basename), absent.bytes)
  const prior = records.find(record => record.id === '2' && record.pointKey === 'p02')
  await pool.execute("UPDATE checkins SET photo_path = '../escape.jpg' WHERE user_id = '2' AND point_key = 'p02'")
  const invalid = await exportActivity({ pool, activityConfig: activity, uploadDir: uploads, out: out('unsafe-path') })
  assert.equal(invalid.exitCode, 2); assert.equal(invalid.info.exceptionalFiles, 1); await inspectBatch(invalid.output, 3, 12)
  await pool.execute("UPDATE checkins SET photo_path = ? WHERE user_id = '2' AND point_key = 'p02'", [prior.basename])
  assert.deepEqual((await report()).summary, expected)
  ok('continuous real replacements stop at3; missing/unsafe sources give explicit partial manifests; completion unchanged')

  const ended = createDatabasePool({ ...settings, database }); await ended.query('SELECT 1'); await ended.end()
  const failureServer = http.createServer(createApp({ activityConfig: activity, pool: ended, runtime }))
  await new Promise(resolve => failureServer.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${failureServer.address().port}/stats/export/summary.csv`, { headers })
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /Pool is closed|DB_PASSWORD|"参与人数",0/)
  } finally { await new Promise(resolve => failureServer.close(resolve)) }
  const finalReadOnlyBefore = await stateDigest()
  await report(); await exportActivity({ pool, activityConfig: activity, uploadDir: uploads, out: out('final-dry'), dryRun: true })
  assert.equal(await stateDigest(), finalReadOnlyBefore)
  ok('real disconnected SQL returns503, not successful empty CSV; final read-only digest stable')
  evidenceInfo.status = 'passed'
} catch (error) {
  evidenceInfo.status = 'failed'; evidenceInfo.failure = { name: error.name, code: error.code || null, message: error.message }
  throw error
} finally {
  clearInterval(sampleMemory)
  if (server) await new Promise(resolve => server.close(resolve))
  if (pool) await pool.end()
  if (admin) { if (created) await admin.query(`DROP DATABASE \`${database}\``); await admin.end() }
  evidenceInfo.durationMs = Date.now() - start; evidenceInfo.peakRssBytes = peakRss
  evidenceInfo.privateSyntheticRoot = privateRoot
  await fs.writeFile(path.join(evidence, 'export-verification.json'), JSON.stringify(evidenceInfo, null, 2))
  console.log(`EXPORT EVIDENCE ${path.relative(process.cwd(), evidence)}`)
  console.log(`SYNTHETIC PRIVATE BATCHES ${batches}`)
  console.log(`RESULT ${assertions.length} assertions; ${evidenceInfo.status}; ${evidenceInfo.durationMs}ms; observed RSS ${peakRss}`)
}
