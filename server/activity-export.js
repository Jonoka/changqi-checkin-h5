import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chinaTime } from './identity.js'
import { validPhotoRevision } from './photo-replacement.js'
import { readActivityReport, selectScope, reportError } from './activity-reports.js'
import { reportCsv, progressCsv, photosCsv, anomaliesCsv } from './report-csv.js'
import { prepareOutput, directoryIdentity, sameDirectory, freeBytes, openSource, committedPhoto, copyCurrentPhoto, photoRelativePath, sourceRoot } from './export-files.js'

const exec = promisify(execFile)
const now = () => chinaTime(new Date())
const messages = {
  ENOENT: '当前引用文件不存在', EACCES: '文件或目录无访问权限', EPERM: '文件或目录操作被拒绝',
  EBUSY: '文件被占用', ENOSPC: '输出磁盘空间耗尽', EDQUOT: '输出配额耗尽', EROFS: '输出位置只读',
  UNSAFE_PHOTO_PATH: '引用不是合法随机 JPEG basename', UNSAFE_PHOTO_FILE: '拒绝链接或非普通来源文件',
  INVALID_JPEG: '引用文件不符合处理后 JPEG 边界', INVALID_PHOTO_REVISION: '引用照片版本非法',
  RECORD_MISSING: '快照记录随后消失', SOURCE_CHANGED: '照片持续变化，有限重试后仍无法稳定读取',
  DATABASE_UNAVAILABLE: '无法读取新的已提交照片引用', INSUFFICIENT_SPACE: '可用空间小于照片及清单预留',
  ABORTED: '导出中断，未处理项不算成功', OUTPUT_WRITE_FAILED: '无法写入本批次文件',
  UNSAFE_DIRECTORY: '目录或祖先不是可信普通目录', DIRECTORY_CHANGED: '批次或来源目录身份发生变化',
  CLAIMED_INCOMPLETE: '已标记领取，但当前必达记录不完整；未修改数据', EXPORT_FAILED: '导出失败，需负责人核对'
}
function safeCode(error, aborted = false) {
  if (aborted || error?.name === 'AbortError') return 'ABORTED'
  return Object.hasOwn(messages, error?.code) ? error.code : 'EXPORT_FAILED'
}

export async function sourceIdentity() {
  const paths = ['scripts/export-activity.mjs', 'server/activity-export.js', 'server/export-files.js', 'server/activity-reports.js', 'server/report-csv.js',
    'server/db.js', 'server/config.js', 'server/identity.js', 'server/photos.js', 'server/photo-replacement.js', 'server/http.js', 'config/activity.json', 'package.json', 'package-lock.json']
  const files = []
  for (const name of paths) files.push({ path: name, sha256: createHash('sha256').update(await fs.readFile(path.join(sourceRoot, name))).digest('hex') })
  let commit = null, dirty = null
  try {
    const result = (await exec('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, timeout: 2000, windowsHide: true })).stdout.trim()
    if (/^[a-f0-9]{40}$/.test(result)) {
      commit = result
      dirty = Boolean((await exec('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: sourceRoot, timeout: 2000, windowsHide: true })).stdout.trim())
    }
  } catch { /* Runtime images intentionally do not contain .git; don't invent a commit/image ID. */ }
  return { commit, dirty, image: null, note: commit ? '提交标识与实际文件哈希同时记录；dirty=true 时不是该提交的原样构建。' : '此环境无法核验提交/镜像标识；以下实际文件哈希可用于比对指定镜像/源码。',
    fingerprint: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files }
}

async function writeNew(batch, name, text, io) {
  await sameDirectory(batch, io)
  let file
  try { file = await io.open(path.join(batch.path, name), 'wx', 0o600); await file.writeFile(text); await file.sync() }
  finally { if (file) await file.close() }
}
async function updateInfo(batch, info, io) {
  await writeNew(batch, '.export-info.part', JSON.stringify(info, null, 2) + '\n', io)
  const target = path.join(batch.path, 'export-info.json'), stat = await io.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw reportError('DIRECTORY_CHANGED')
  await sameDirectory(batch, io)
  await io.rename(path.join(batch.path, '.export-info.part'), target)
}

export async function exportActivity({ pool, activityConfig, uploadDir, out, scope = 'participants', dryRun = false, exclusionFile = '', signal, io = fs, hooks = {} }) {
  const startedAt = now()
  const location = await prepareOutput(out, uploadDir, io)
  signal?.throwIfAborted()
  const report = await readActivityReport(pool, activityConfig, { exclusionFile, includeInventory: true })
  const selection = selectScope(report, scope)
  const pointNames = new Map(report.points.map(point => [point.key, point.name]))
  const reserveBytes = BigInt(Math.max(1048576, selection.photos.length * 4096 + selection.users.length * 2048))
  let estimatedBytes = 0n, readableFiles = 0
  const preflightAnomalies = []
  const destinations = new Set()
  for (const photo of selection.photos) {
    signal?.throwIfAborted()
    const relative = photoRelativePath(photo, pointNames.get(photo.pointKey))
    if (destinations.has(relative.toLowerCase())) throw reportError('UNSAFE_OUTPUT_NAME')
    destinations.add(relative.toLowerCase())
    let opened
    try {
      const current = await committedPhoto(pool, photo)
      opened = await openSource(location.upload, current.photo_path, io)
      estimatedBytes += BigInt(opened.stat.size); readableFiles++
    } catch (error) {
      if (error.code === 'DATABASE_UNAVAILABLE') throw error
      const code = safeCode(error)
      preflightAnomalies.push({ cq: photo.cq, pointKey: photo.pointKey, code, message: messages[code] })
    } finally { if (opened) await opened.handle.close() }
  }
  const available = await freeBytes(location.parent.path, io)
  if (available < estimatedBytes + reserveBytes) throw reportError('INSUFFICIENT_SPACE')
  const preflight = { selectedUsers: selection.users.length, expectedFiles: selection.photos.length, readableFiles,
    estimatedPhotoBytes: estimatedBytes.toString(), metadataReserveBytes: reserveBytes.toString(), availableBytes: available.toString(), anomalies: preflightAnomalies }
  if (dryRun) return { exitCode: preflightAnomalies.length ? 2 : 0, dryRun: true, output: location.target, queriedAt: report.queriedAt, scope, summary: report.summary, exclusion: report.exclusion, ...preflight }

  await hooks.afterSnapshot?.({ report, selection })
  signal?.throwIfAborted()
  await sameDirectory(location.parent, io)
  await io.mkdir(location.target, { mode: 0o700 }) // EEXIST: never overwrite/reuse a previous batch.
  const batch = await directoryIdentity(location.target, io)
  const info = { batch: `${Date.now()}-${randomBytes(4).toString('hex')}`, activity: report.activityName, ruleVersion: report.ruleVersion,
    queriedAt: report.queriedAt, exportStartedAt: startedAt, exportEndedAt: null, timezone: report.timezone, scope,
    requiredKeys: report.requiredKeys, configHash: report.configHash, exclusion: report.exclusion,
    source: null, selectedUsers: selection.users.length, expectedFiles: selection.photos.length, successfulFiles: 0, exceptionalFiles: 0,
    pendingFiles: selection.photos.length, status: 'in_progress', complete: false,
    consistency: '统计/选人/预期清单为起始快照；照片逐张读取随后已提交版本，非整包同一时刻。',
    use: '仅本活动内部记录/核查；不构成对外宣传授权。首次打卡时间不是最后重拍时间或原始拍摄时间。' }
  const results = [], anomalies = selection.users.filter(user => user.claimedAt && !user.allCompleted).map(user => ({ cq: user.cq, pointKey: '', code: 'CLAIMED_INCOMPLETE', message: messages.CLAIMED_INCOMPLETE }))
  let fatal = null, infoCreated = false, manifestsWritten = false
  const rowFor = photo => ({ cq: photo.cq, pointKey: photo.pointKey, pointName: pointNames.get(photo.pointKey), createdAt: photo.createdAt,
    snapshotRevision: validPhotoRevision(photo.revision) ? photo.revision : '', actualRevision: '', relativePath: '', bytes: 0, sha256: '', exportedAt: now(), result: '', attempts: 0 })
  try {
    await writeNew(batch, 'export-info.json', JSON.stringify(info, null, 2) + '\n', io); infoCreated = true
    info.source = await sourceIdentity()
    for (const [filename, type] of [['统计汇总.csv', 'summary'], ['地点统计.csv', 'points'], ['每日统计.csv', 'daily']]) await writeNew(batch, filename, reportCsv(report, type), io)
    await writeNew(batch, '游客进度.csv', progressCsv(report, selection.users), io)
    await io.mkdir(path.join(batch.path, 'photos'), { mode: 0o700 })
    const created = new Set()
    for (const photo of selection.photos) {
      const row = rowFor(photo)
      try {
        signal?.throwIfAborted()
        if (!validPhotoRevision(photo.revision)) throw reportError('INVALID_PHOTO_REVISION')
        if (!created.has(photo.cq)) {
          await sameDirectory(batch, io)
          await io.mkdir(path.join(batch.path, 'photos', photo.cq), { mode: 0o700 }); created.add(photo.cq)
        }
        const relativePath = photoRelativePath(photo, row.pointName)
        Object.assign(row, await copyCurrentPhoto({ pool, photo, upload: location.upload, batch, relativePath, reserveBytes, signal, io, hooks }), { relativePath, result: '成功', exportedAt: now() })
      } catch (error) {
        const code = safeCode(error, signal?.aborted)
        row.result = code; row.attempts = error.attempts || 0; row.exportedAt = now()
        anomalies.push({ cq: photo.cq, pointKey: photo.pointKey, code, message: messages[code] })
        if (['DATABASE_UNAVAILABLE', 'INSUFFICIENT_SPACE', 'ENOSPC', 'EDQUOT', 'EROFS', 'DIRECTORY_CHANGED', 'UNSAFE_DIRECTORY', 'ABORTED', 'EXPORT_FAILED'].includes(code)) fatal = code
      }
      results.push(row)
      if (fatal) break
    }
  } catch (error) { fatal = safeCode(error, signal?.aborted) }
  // Remaining expected files get explicit non-success records even after interruption/disconnect.
  for (const photo of selection.photos.slice(results.length)) {
    const code = fatal || 'ABORTED'
    results.push({ ...rowFor(photo), result: code })
    anomalies.push({ cq: photo.cq, pointKey: photo.pointKey, code, message: messages[code] })
  }
  info.successfulFiles = results.filter(row => row.result === '成功').length
  info.exceptionalFiles = info.expectedFiles - info.successfulFiles; info.pendingFiles = 0
  info.businessAnomalies = anomalies.filter(row => row.code === 'CLAIMED_INCOMPLETE').length
  try {
    await writeNew(batch, '照片清单.csv', photosCsv(report, results), io)
    await writeNew(batch, '异常清单.csv', anomaliesCsv(report, anomalies), io)
    manifestsWritten = true
  } catch (error) { fatal = safeCode(error, signal?.aborted) }
  info.exportEndedAt = now()
  info.status = fatal ? 'failed' : info.exceptionalFiles || info.businessAnomalies ? 'partial' : 'complete'
  info.complete = info.status === 'complete'; info.failureCode = fatal
  let finalInfoWritten = false
  if (infoCreated) {
    try { await updateInfo(batch, info, io); finalInfoWritten = true } catch { fatal = 'OUTPUT_WRITE_FAILED' }
  } else fatal ||= 'OUTPUT_WRITE_FAILED'
  // A stale in_progress info/partial manifest is never advertised as a complete batch.
  if (!manifestsWritten || !finalInfoWritten) { info.status = 'failed'; info.complete = false; info.failureCode = fatal || 'OUTPUT_WRITE_FAILED' }
  return { exitCode: info.status === 'failed' ? 1 : info.status === 'partial' ? 2 : 0, output: location.target, info, preflight, manifestsWritten, finalInfoWritten }
}
