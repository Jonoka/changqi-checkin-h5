import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { validateActivityConfig } from './config.js'
import { chinaTime } from './identity.js'

export const REPORT_VERSION = 'activity-report-v1'
export const REPORT_TIMEZONE = '+08:00'
// Bound metadata memory, never return a truncated report as a successful one.
export const MAX_REPORT_ROWS = 200000
export class ReportError extends Error {
  constructor(code) { super(code); this.code = code }
}
export const reportError = code => new ReportError(code)
export function userId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw reportError('INVALID_USER_ID')
  const id = String(value)
  if (!/^[1-9]\d{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n) throw reportError('INVALID_USER_ID')
  return id
}
export const cqLabel = id => `CQ${userId(id).padStart(6, '0')}`

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export function reportDefinition(activity) {
  validateActivityConfig(activity)
  const points = [...activity.points].sort((a, b) => a.displayOrder - b.displayOrder).map(({ key, name }) => {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(key)) throw reportError('INVALID_POINT_KEY')
    return { key, name }
  })
  return { activityName: activity.activityName, points, requiredKeys: points.map(point => point.key), total: points.length,
    configHash: createHash('sha256').update(JSON.stringify(canonical(activity))).digest('hex') }
}

export function parseExcludedCqs(values) {
  if (!Array.isArray(values) || values.length > 10000) throw reportError('INVALID_EXCLUSION_LIST')
  const ids = new Set()
  for (const cq of values) {
    if (typeof cq !== 'string' || !/^CQ\d{6,20}$/.test(cq)) throw reportError('INVALID_EXCLUSION_LIST')
    let id
    try { id = userId(BigInt(cq.slice(2)).toString()) } catch { throw reportError('INVALID_EXCLUSION_LIST') }
    if (cqLabel(id) !== cq || ids.has(id)) throw reportError('INVALID_EXCLUSION_LIST')
    ids.add(id)
  }
  return ids
}

// Server-only JSON file. No fallback when an explicitly selected file is invalid/unreadable.
export function loadReportExclusions(filename = '') {
  if (filename === '') return new Set()
  try {
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('absolute file required')
    const stat = fs.lstatSync(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error('invalid file')
    return parseExcludedCqs(JSON.parse(fs.readFileSync(filename, 'utf8')))
  } catch (error) {
    if (error instanceof ReportError) throw error
    throw reportError('EXCLUSION_FILE_UNAVAILABLE')
  }
}

function timestamp(value) {
  if (value === null || value === undefined) return null
  const text = chinaTime(value)
  const date = new Date(text)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(text) || !Number.isFinite(date.getTime()) || chinaTime(date) !== text) throw reportError('INVALID_EVENT_TIME')
  return text
}

export function aggregateReport(rows, definition, excludedIds, queriedAt, includeInventory = false) {
  if (!definition.total || definition.total !== new Set(definition.requiredKeys).size || !timestamp(queriedAt)) throw reportError('INVALID_REPORT_DEFINITION')
  if (!Array.isArray(rows) || rows.length > MAX_REPORT_ROWS) throw reportError('REPORT_SIZE_LIMIT')
  const keys = new Set(definition.requiredKeys), visitors = new Map(), excluded = new Set()
  const points = definition.points.map(point => ({ ...point, users: 0 }))
  const pointCounts = new Map(points.map(point => [point.key, point]))
  for (const row of rows) {
    const id = userId(row.id)
    if (excludedIds.has(id)) { excluded.add(id); continue }
    let visitor = visitors.get(id)
    if (!visitor) {
      visitor = { id, cq: cqLabel(id), claimedAt: timestamp(row.claimed_at), records: new Map() }
      visitors.set(id, visitor)
    } else if (visitor.claimedAt !== timestamp(row.claimed_at)) throw reportError('INCONSISTENT_REPORT')
    if (row.point_key == null) continue
    if (!keys.has(row.point_key)) throw reportError('UNEXPECTED_POINT_KEY')
    if (visitor.records.has(row.point_key)) throw reportError('DUPLICATE_CHECKIN')
    const createdAt = timestamp(row.created_at)
    if (!createdAt) throw reportError('INVALID_EVENT_TIME')
    const record = { userId: id, cq: visitor.cq, pointKey: row.point_key, createdAt }
    if (includeInventory) { record.photoPath = row.photo_path; record.revision = row.photo_revision }
    visitor.records.set(row.point_key, record)
    pointCounts.get(row.point_key).users++
  }
  const summary = { identified: 0, participants: 0, completed: 0, claimed: 0, completedUnclaimed: 0, photoRecords: 0, claimedIncomplete: 0 }
  const daily = new Map(), users = [], inventory = []
  function event(time, field) {
    if (!time) return
    const date = time.slice(0, 10)
    if (!daily.has(date)) daily.set(date, { date, participants: 0, completed: 0, claimed: 0 })
    daily.get(date)[field]++
  }
  for (const visitor of visitors.values()) {
    const records = [...visitor.records.values()].sort((a, b) => definition.requiredKeys.indexOf(a.pointKey) - definition.requiredKeys.indexOf(b.pointKey))
    const times = records.map(record => record.createdAt).sort()
    const completedCount = records.length, allCompleted = completedCount === definition.total && definition.total > 0
    const firstParticipationAt = times[0] || null, completedAt = allCompleted ? times.at(-1) : null
    summary.identified++
    if (completedCount) summary.participants++
    if (allCompleted) summary.completed++
    if (visitor.claimedAt) summary.claimed++
    if (allCompleted && !visitor.claimedAt) summary.completedUnclaimed++
    if (visitor.claimedAt && !allCompleted) summary.claimedIncomplete++
    summary.photoRecords += completedCount
    event(firstParticipationAt, 'participants'); event(completedAt, 'completed'); event(visitor.claimedAt, 'claimed')
    if (includeInventory) {
      users.push({ id: visitor.id, cq: visitor.cq, completedCount, total: definition.total, allCompleted, firstParticipationAt, completedAt, claimedAt: visitor.claimedAt })
      inventory.push(...records)
    }
  }
  return { ...definition, ruleVersion: REPORT_VERSION, timezone: REPORT_TIMEZONE, queriedAt: timestamp(queriedAt),
    exclusion: { enabled: excludedIds.size > 0, matchedUsers: excluded.size }, summary, points,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)), ...(includeInventory ? { users, inventory } : {}) }
}

// One short read-only consistent snapshot. No file work or per-visitor query inside it.
export async function readActivityReport(pool, activity, { exclusionFile = '', includeInventory = false } = {}) {
  const definition = reportDefinition(activity), excludedIds = loadReportExclusions(exclusionFile)
  if (!pool) throw reportError('REPORT_DB_UNAVAILABLE')
  let connection, destroyed = false, active = false
  try {
    connection = await pool.getConnection()
    await connection.query("SET time_zone = '+08:00'")
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    active = true
    const [clock] = await connection.query('SELECT NOW() AS queried_at')
    const placeholders = definition.requiredKeys.map(() => '?').join(',')
    const columns = includeInventory ? ', c.photo_path, c.photo_revision' : ''
    const [rows] = await connection.query({ sql: `SELECT u.id, u.claimed_at, c.point_key, c.created_at${columns}
      FROM users u LEFT JOIN checkins c ON c.user_id = u.id AND BINARY c.point_key IN (${placeholders})
      ORDER BY u.id, c.point_key LIMIT ${MAX_REPORT_ROWS + 1}`, timeout: 15000 }, definition.requiredKeys)
    await connection.commit(); active = false
    // CPU aggregation and subsequent photo copies do not hold a database transaction.
    return aggregateReport(rows, definition, excludedIds, clock[0]?.queried_at, includeInventory)
  } catch (error) {
    if (connection && active) {
      try { await connection.rollback() } catch { connection.destroy(); destroyed = true }
    }
    throw error
  } finally { if (connection && !destroyed) connection.release() }
}

export function selectScope(report, scope = 'participants') {
  if (!['participants', 'completed', 'claimed'].includes(scope) || !report.users || !report.inventory) throw reportError('INVALID_SCOPE')
  const users = report.users.filter(user => scope === 'claimed' ? Boolean(user.claimedAt) : scope === 'completed' ? user.allCompleted : user.completedCount > 0)
  const selected = new Set(users.map(user => user.id))
  return { users, photos: report.inventory.filter(photo => selected.has(photo.userId)) }
}
