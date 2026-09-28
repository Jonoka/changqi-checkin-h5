import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { loadActivityConfig } from '../server/config.js'
import { runtimeConfig } from '../server/runtime.js'
import { createApp } from '../server/app.js'
import { aggregateReport, reportDefinition, readActivityReport, parseExcludedCqs, loadReportExclusions, cqLabel, selectScope } from '../server/activity-reports.js'
import { csv, csvCell, reportCsv } from '../server/report-csv.js'
import { prepareOutput, directoryIdentity, sourceRoot, safeName, openSource, copyCurrentPhoto } from '../server/export-files.js'
import { exportActivity } from '../server/activity-export.js'
import { parseArgs } from './export-activity.mjs'

const activity = loadActivityConfig(), definition = reportDefinition(activity), queriedAt = '2026-09-25 12:00:00'
const rows = [{ id: '1', claimed_at: null, point_key: null, created_at: null }]
for (const [id, count, claimed] of [['2', 2, null], ['3', 5, null], ['4', 5, '2026-09-25 00:00:00']]) {
  for (let i = 0; i < count; i++) rows.push({ id, claimed_at: claimed, point_key: `p0${i + 1}`, created_at: i === 4 ? '2026-09-25 00:00:00' : '2026-09-24 23:59:59', photo_path: 'a'.repeat(32) + '.jpg', photo_revision: 'initial' })
}
const expected = { identified: 4, participants: 3, completed: 2, claimed: 1, completedUnclaimed: 1, photoRecords: 12, claimedIncomplete: 0 }
function fakePool(data = rows, current = null) {
  const calls = []
  return { calls, getConnection: async () => ({ query: async query => {
    const sql = typeof query === 'string' ? query : query.sql; calls.push(sql)
    return sql.startsWith('SELECT NOW') ? [[{ queried_at: queriedAt }]] : sql.startsWith('SELECT u.id') ? [structuredClone(data)] : [[]]
  }, commit: async () => calls.push('COMMIT'), rollback: async () => calls.push('ROLLBACK'), release: () => calls.push('RELEASE'), destroy: () => calls.push('DESTROY') }),
  execute: async () => [[current ? current() : { photo_path: 'a'.repeat(32) + '.jpg', photo_revision: 'initial' }]] }
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'changqi-export-unit-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const uploads = path.join(directory, 'uploads'); await fs.mkdir(uploads)
  const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#123456' } }).jpeg().toBuffer()
  await fs.writeFile(path.join(uploads, 'a'.repeat(32) + '.jpg'), bytes)
  return { directory, uploads, bytes }
}

// Independent CSV parser for assertions: not the production serializer used backwards.
export function parseCsv(text) {
  const result = []; let row = [], cell = '', quoted = false
  text = text.replace(/^\ufeff/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (!quoted && c === ',') { row.push(cell); cell = '' }
    else if (!quoted && c === '\n') { row.push(cell.replace(/\r$/, '')); result.push(row); row = []; cell = '' }
    else cell += c
  }
  assert.equal(quoted, false)
  return result
}

test('reports: independent 4/3/2/1/1/12 oracle, zero sites, daily events aggregate complete history first', () => {
  const report = aggregateReport(rows, definition, new Set(), queriedAt, true)
  assert.deepEqual(report.summary, expected)
  assert.deepEqual(report.points.map(point => point.users), [3, 3, 2, 2, 2])
  assert.deepEqual(report.daily, [{ date: '2026-09-24', participants: 3, completed: 0, claimed: 0 }, { date: '2026-09-25', participants: 0, completed: 2, claimed: 1 }])
  assert.deepEqual(aggregateReport([], definition, new Set(), queriedAt).points.map(point => point.users), [0, 0, 0, 0, 0])
  assert.deepEqual(selectScope(report, 'participants').users.map(user => user.cq), ['CQ000002', 'CQ000003', 'CQ000004'])
  assert.equal(selectScope(report, 'completed').photos.length, 10); assert.equal(selectScope(report, 'claimed').photos.length, 5)
  assert.throws(() => reportDefinition({ ...activity, points: [] }))
  assert.throws(() => reportDefinition({ ...activity, points: [...activity.points, activity.points[0]] }))
})

test('reports: CQ BIGINT precision, explicit exclusions, no guessed date/id filtering, invalid lists fail', async t => {
  assert.equal(cqLabel('9007199254740993'), 'CQ9007199254740993')
  assert.throws(() => cqLabel(9007199254740993))
  const excluded = parseExcludedCqs(['CQ000002', 'CQ9007199254740993'])
  const report = aggregateReport(rows, definition, excluded, queriedAt)
  assert.deepEqual(report.summary, { identified: 3, participants: 2, completed: 2, claimed: 1, completedUnclaimed: 1, photoRecords: 10, claimedIncomplete: 0 })
  assert.deepEqual(report.exclusion, { enabled: true, matchedUsers: 1 })
  for (const bad of ['CQ000001', ['CQ1'], ['CQ000000'], ['CQ000001', 'CQ000001'], ['CQ09007199254740993'], ['CQ18446744073709551616']]) assert.throws(() => parseExcludedCqs(bad))
  assert.equal(loadReportExclusions().size, 0)
  const { directory } = await fixture(t), list = path.join(directory, 'confirmed.json')
  await fs.writeFile(list, '["CQ000002"]'); assert.deepEqual([...loadReportExclusions(list)], ['2'])
  await fs.writeFile(list, '{broken'); assert.throws(() => loadReportExclusions(list))
  assert.throws(() => loadReportExclusions(path.join(directory, 'absent.json')))
})

test('reports: claimed-incomplete is independent; missing bytes never change progress; +08 boundary Date conversion', () => {
  const changed = structuredClone(rows); changed[0].claimed_at = '2026-09-25 01:00:00'; changed[1].photo_path = '../unsafe'
  const report = aggregateReport(changed, definition, new Set(), new Date('2026-09-24T16:00:00Z'), true)
  assert.equal(report.summary.claimed, 2); assert.equal(report.summary.completedUnclaimed, 1); assert.equal(report.summary.claimedIncomplete, 1)
  assert.equal(report.summary.completed, 2); assert.equal(report.summary.photoRecords, 12)
  assert.equal(report.queriedAt, '2026-09-25T00:00:00+08:00')
  assert.throws(() => aggregateReport([...rows, rows[1]], definition, new Set(), queriedAt), /DUPLICATE/)
})

test('reports: same-connection short read-only snapshot ends and releases before delivery; rollback failure destroys', async () => {
  const pool = fakePool()
  assert.deepEqual((await readActivityReport(pool, activity)).summary, expected)
  assert.match(pool.calls.join('\n'), /START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY/)
  assert.match(pool.calls.join('\n'), /BINARY c.point_key IN/)
  assert.doesNotMatch(pool.calls.join('\n'), /FOR UPDATE|LOCK TABLE|INSERT|UPDATE users|photo_path|openid|claim_code/)
  assert.deepEqual(pool.calls.slice(-2), ['COMMIT', 'RELEASE'])
  let destroyed = false, released = false
  const broken = { getConnection: async () => ({ query: async sql => { if (String(sql).startsWith('SELECT NOW')) throw new Error('read failed') }, rollback: async () => { throw new Error('offline') }, destroy: () => { destroyed = true }, release: () => { released = true } }) }
  await assert.rejects(readActivityReport(broken, activity)); assert.equal(destroyed, true); assert.equal(released, false)
})

test('CSV: BOM, independent round-trip quotes/comma/newlines, formulas = + - @ tab and full-width disarmed, counts numeric', () => {
  const bad = ['=2+2', '+SUM(1,2)', '-1+1', '@SUM(A1)', '\t=1', '\r=1', '\n=1', '  =1', '＝1', '+"a,b"\n@2']
  const output = csv([['中文', 'CQ9007199254740993', 12, 0], ['a,b', 'a"b', 'a\nb'], bad])
  assert.equal(output.charCodeAt(0), 0xfeff)
  const parsed = parseCsv(output)
  assert.deepEqual(parsed[0], ['中文', 'CQ9007199254740993', '12', '0'])
  assert.deepEqual(parsed[1], ['a,b', 'a"b', 'a\nb'])
  assert.deepEqual(parsed[2], bad.map(value => `'${value}`))
  assert.equal(csvCell(12), '12'); assert.equal(csvCell(0), '0')
  assert.throws(() => csvCell(NaN))
  for (const type of ['summary', 'points', 'daily']) {
    const text = reportCsv(aggregateReport([], definition, new Set(), queriedAt), type)
    assert.match(text, /北京时间|\+08:00/); assert.match(text, /长岐村漫游打卡/)
    assert.doesNotMatch(text, /openid|claim_code|photo_path|CQ00000/i)
  }
})

test('HTTP: all fixed CSVs authenticate before queries, unknown report404, missing503, query failure not empty success', async () => {
  for (const enabled of [false, true]) {
    let queries = 0
    const runtime = runtimeConfig(enabled ? { STATS_USER: 'test', STATS_PASSWORD: 'test-password-12345' } : {})
    const app = createApp({ activityConfig: activity, runtime, pool: { getConnection: async () => { queries++; throw new Error('PRIVATE SQL/password') } } })
    const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${server.address().port}`
      const headers = { authorization: 'Basic ' + Buffer.from('test:test-password-12345').toString('base64') }
      for (const route of ['/stats', '/stats/export/summary.csv', '/stats/export/points.csv', '/stats/export/daily.csv', '/stats/export/private.csv']) {
        assert.equal((await fetch(base + route)).status, enabled ? 401 : 503)
      }
      assert.equal(queries, 0)
      if (enabled) {
        assert.equal((await fetch(base + '/stats/export/private.csv', { headers })).status, 404); assert.equal(queries, 0)
        const response = await fetch(base + '/stats/export/summary.csv', { headers })
        assert.equal(response.status, 503); assert.doesNotMatch(response.headers.get('content-type'), /csv/)
        assert.doesNotMatch(await response.text(), /PRIVATE|password|0,|openid/)
      }
    } finally { await new Promise(resolve => server.close(resolve)) }
  }
})

test('export: explicit arguments, no overwrite, outside source/uploads; safe Windows names; junction rejection', async t => {
  const { directory, uploads } = await fixture(t), out = path.join(directory, 'new-batch')
  assert.deepEqual(parseArgs(['--out', out]), { out, scope: 'participants', dryRun: false })
  assert.deepEqual(parseArgs(['--help']), { help: true })
  for (const args of [[], ['--out', 'relative'], ['--out', out, '--scope', 'all'], ['--out', out, '--dry-run', '--dry-run'], ['--wat']]) assert.throws(() => parseArgs(args))
  await prepareOutput(out, uploads)
  await assert.rejects(prepareOutput(uploads, uploads))
  await assert.rejects(prepareOutput(path.join(uploads, 'batch'), uploads), /OUTPUT_OVERLAPS_SOURCE/)
  await assert.rejects(prepareOutput(path.join(sourceRoot, 'batch'), uploads), /OUTPUT_OVERLAPS_SOURCE/)
  assert.equal(safeName('CON'), '地点_CON'); assert.doesNotMatch(safeName('../x:<a>|?* .'), /[\\/:<>|?*]|[. ]$/)
  await fs.mkdir(out); await assert.rejects(prepareOutput(out, uploads), /OUTPUT_ALREADY_EXISTS/)
  const junction = path.join(directory, 'link')
  await fs.symlink(uploads, junction, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareOutput(path.join(junction, 'batch'), uploads), /UNSAFE_DIRECTORY/)
})

test('export: source traversal, hardlinks, invalid JPEG and simulated denied file read rejected', async t => {
  const { uploads } = await fixture(t), upload = await directoryIdentity(uploads), basename = 'a'.repeat(32) + '.jpg'
  await assert.rejects(openSource(upload, '../photo.jpg'), /UNSAFE_PHOTO_PATH/)
  await fs.writeFile(path.join(uploads, 'b'.repeat(32) + '.jpg'), 'not JPEG')
  await assert.rejects(openSource(upload, 'b'.repeat(32) + '.jpg'), /INVALID_JPEG/)
  await fs.link(path.join(uploads, basename), path.join(uploads, 'linked.jpg'))
  await assert.rejects(openSource(upload, basename), /UNSAFE_PHOTO_FILE/)
  await fs.unlink(path.join(uploads, 'linked.jpg'))
  const denied = { ...fs, open: async () => { throw Object.assign(new Error('simulated denied'), { code: 'EACCES' }) } }
  await assert.rejects(openSource(upload, basename, denied), error => error.code === 'EACCES')
})

test('export: streamed bytes/hash unchanged, fresh committed revision retry bounded at3, own temporary removed', async t => {
  const { directory, uploads, bytes } = await fixture(t), upload = await directoryIdentity(uploads)
  const out = path.join(directory, 'copy'); await fs.mkdir(out); const batch = await directoryIdentity(out)
  const photo = { userId: '2', cq: 'CQ000002', pointKey: 'p01' }
  let current = { photo_path: 'a'.repeat(32) + '.jpg', photo_revision: 'initial' }, reads = 0
  const pool = { execute: async () => { reads++; return [[{ ...current }]] } }
  const result = await copyCurrentPhoto({ pool, photo, upload, batch, relativePath: 'stable.jpg' })
  assert.equal(result.bytes, bytes.length); assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(await fs.readFile(path.join(out, 'stable.jpg')), bytes)
  assert.equal(reads, 2)
  const changed = await copyCurrentPhoto({ pool, photo, upload, batch, relativePath: 'retry.jpg', hooks: { afterCopy: ({ attempt }) => { if (attempt === 1) current.photo_revision = randomUUID() } } })
  assert.equal(changed.attempts, 2); assert.equal(changed.actualRevision, current.photo_revision)
  await assert.rejects(copyCurrentPhoto({ pool, photo, upload, batch, relativePath: 'changing.jpg', hooks: { afterCopy: () => { current.photo_revision = randomUUID() } } }), error => error.code === 'SOURCE_CHANGED' && error.attempts === 3)
  assert.deepEqual((await fs.readdir(out)).sort(), ['retry.jpg', 'stable.jpg'])
  // File deletion without any database change must not succeed via an old open handle.
  await assert.rejects(copyCurrentPhoto({ pool, photo, upload, batch, relativePath: 'removed.jpg', hooks: {
    afterCopy: async () => fs.unlink(path.join(uploads, current.photo_path))
  } }), error => error.code === 'ENOENT' && error.attempts === 3)
  assert.deepEqual((await fs.readdir(out)).sort(), ['retry.jpg', 'stable.jpg'])
  await fs.writeFile(path.join(uploads, current.photo_path), bytes)
  let replacedName = false
  const rebound = await copyCurrentPhoto({ pool, photo, upload, batch, relativePath: 'rebound.jpg', hooks: {
    afterCopy: async ({ attempt }) => {
      if (attempt !== 1) return
      const replacement = path.join(uploads, 'c'.repeat(32) + '.jpg')
      await fs.writeFile(replacement, bytes)
      await fs.rename(replacement, path.join(uploads, current.photo_path)); replacedName = true
    }
  } })
  assert.equal(replacedName, true); assert.equal(rebound.attempts, 2)
  assert.deepEqual(await fs.readFile(path.join(out, 'rebound.jpg')), bytes)
})

test('export: dry-run creates nothing; scope separate from activity totals; missing file partial reconciles and no secrets', async t => {
  const { directory, uploads } = await fixture(t), out = path.join(directory, 'dry')
  const dry = await exportActivity({ pool: fakePool(), activityConfig: activity, uploadDir: uploads, out, dryRun: true, scope: 'claimed' })
  assert.equal(dry.exitCode, 0); assert.equal(dry.selectedUsers, 1); assert.equal(dry.expectedFiles, 5); assert.deepEqual(dry.summary, expected)
  await assert.rejects(fs.stat(out), error => error.code === 'ENOENT')
  const result = await exportActivity({ pool: fakePool(), activityConfig: activity, uploadDir: uploads, out, scope: 'claimed' })
  assert.equal(result.exitCode, 0); assert.equal(result.info.successfulFiles, 5); assert.equal(result.info.selectedUsers, 1)
  assert.match(await fs.readFile(path.join(out, '统计汇总.csv'), 'utf8'), /"参与人数",3/)
  assert.match(await fs.readFile(path.join(out, '游客进度.csv'), 'utf8'), /CQ000004/)
  assert.doesNotMatch(await fs.readFile(path.join(out, '游客进度.csv'), 'utf8'), /CQ000002/)
  const missing = await exportActivity({ pool: fakePool(rows, () => ({ photo_path: 'f'.repeat(32) + '.jpg', photo_revision: 'initial' })), activityConfig: activity, uploadDir: uploads, out: path.join(directory, 'missing'), scope: 'claimed' })
  assert.equal(missing.exitCode, 2); assert.equal(missing.info.exceptionalFiles, 5); assert.equal(missing.info.successfulFiles, 0)
  assert.equal(missing.info.expectedFiles, missing.info.successfulFiles + missing.info.exceptionalFiles)
  const files = await fs.readdir(out)
  for (const name of files.filter(name => /\.csv$|\.json$/.test(name))) {
    const text = await fs.readFile(path.join(out, name), 'utf8')
    assert.doesNotMatch(text, /openid|claimCode|claim_code|Cookie|DB_PASSWORD|[A-Z]:\\|file:\/\//i)
    assert.equal(text.includes(uploads), false)
  }
})

test('export: space and output-permission fault injection, interruption and database loss do not fake success', async t => {
  const { directory, uploads } = await fixture(t)
  const base = { pool: fakePool(), activityConfig: activity, uploadDir: uploads, scope: 'claimed' }
  const out = path.join(directory, 'space')
  await assert.rejects(exportActivity({ ...base, out, dryRun: true, io: { ...fs, statfs: async () => ({ bavail: 0n, bsize: 4096n }) } }), /INSUFFICIENT_SPACE/)
  await assert.rejects(fs.stat(out), error => error.code === 'ENOENT')
  const controller = new AbortController()
  const interrupted = await exportActivity({ ...base, out: path.join(directory, 'interrupted'), signal: controller.signal, hooks: { afterCopy: () => controller.abort() } })
  assert.equal(interrupted.exitCode, 1); assert.equal(interrupted.info.status, 'failed'); assert.equal(interrupted.info.exceptionalFiles, 5)
  assert.match(await fs.readFile(path.join(interrupted.output, '异常清单.csv'), 'utf8'), /ABORTED/)
  const denied = await exportActivity({ ...base, out: path.join(directory, 'denied'), io: { ...fs, open: async (name, flags, mode) => {
    if (String(name).endsWith('照片清单.csv')) throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' })
    return fs.open(name, flags, mode)
  } } })
  assert.equal(denied.exitCode, 1); assert.equal(denied.info.complete, false)
  assert.equal(JSON.parse(await fs.readFile(path.join(denied.output, 'export-info.json'), 'utf8')).status, 'failed')
  let reads = 0
  const disconnect = await exportActivity({ ...base, pool: { ...fakePool(), execute: async () => {
    if (++reads > 5) throw new Error('SIMULATED disconnected')
    return [[{ photo_path: 'a'.repeat(32) + '.jpg', photo_revision: 'initial' }]]
  } }, out: path.join(directory, 'disconnect') })
  assert.equal(disconnect.exitCode, 1); assert.equal(disconnect.info.exceptionalFiles, 5)
})
