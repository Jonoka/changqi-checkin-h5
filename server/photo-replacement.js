import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import multer from 'multer'
import { HttpError } from './http.js'
import { requireUserSession, chinaTime } from './identity.js'
import { findCheckin, maxPhotoBytes, processPhoto, storedPhotoPath } from './photos.js'

export const replacementIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const validPhotoRevision = value => typeof value === 'string' && (value === 'initial' || replacementIdPattern.test(value))
export const photoConflict = () => new HttpError(409, 'PHOTO_CONFLICT', '照片已有其他版本，请刷新当前照片并核对，不能覆盖其他修改')
const uncertain = () => Object.assign(new HttpError(503, 'REPLACEMENT_UNCERTAIN', '替换结果待核对，请继续核对或重试同一次修改，不要新建修改'), { preservePhoto: true })
const unavailable = () => new HttpError(500, 'REPLACEMENT_FAILED', '本次替换未保存，原照片和打卡记录保持不变')
const label = id => `CQ${String(id).padStart(6, '0')}`

export async function photoInventory(pool, userId, activity) {
  // One statement gives a coherent owner/claim/photo snapshot. No private path leaves this module.
  const [rows] = await pool.execute('SELECT u.id, u.claimed_at, c.point_key, c.photo_revision, c.created_at FROM users u LEFT JOIN checkins c ON c.user_id = u.id WHERE u.id = ?', [userId])
  if (!rows.length) throw new HttpError(401, 'NEED_LOGIN', '身份已失效，请重新进入活动')
  const saved = new Map(rows.filter(row => row.point_key).map(row => [row.point_key, row]))
  return {
    userLabel: label(rows[0].id), enabled: activity.enabled, claimedAt: chinaTime(rows[0].claimed_at),
    photos: [...activity.points].sort((a, b) => a.displayOrder - b.displayOrder).map(point => {
      const row = saved.get(point.key)
      return { pointKey: point.key, revision: row?.photo_revision ?? null, createdAt: chinaTime(row?.created_at), canReplace: Boolean(row && activity.enabled && !rows[0].claimed_at) }
    })
  }
}

// All photo processing is finished before this short transaction starts.
// Claims take the SAME users lock first, on their own single connection.
export async function replacePhotoRecord(pool, { userId, pointKey, expectedRevision, replacementId, filename, activity }) {
  let connection, committing = false, destroyed = false, oldPath
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    const [users] = await connection.execute('SELECT id, claimed_at FROM users WHERE id = ? FOR UPDATE', [userId])
    if (!users[0]) throw new HttpError(401, 'NEED_LOGIN', '身份已失效，请重新进入活动')
    const [rows] = await connection.execute('SELECT photo_path, photo_revision FROM checkins WHERE user_id = ? AND point_key = ? FOR UPDATE', [userId, pointKey])
    const record = rows[0]
    if (!record) throw new HttpError(404, 'PHOTO_NOT_FOUND', '尚无该地点记录，首次打卡仍需扫描地点码')
    if (record.photo_revision === replacementId) {
      await connection.rollback()
      return { referenced: false, duplicate: true }
    }
    if (users[0].claimed_at) throw new HttpError(409, 'ALREADY_CLAIMED', '已领取礼品，照片只能查看，不能修改')
    if (!activity.enabled) throw new HttpError(409, 'ACTIVITY_DISABLED', '活动暂未开放或已结束，照片只能查看')
    if (record.photo_revision !== expectedRevision) throw photoConflict()
    oldPath = record.photo_path
    const [updated] = await connection.execute('UPDATE checkins SET photo_path = ?, photo_revision = ? WHERE user_id = ? AND point_key = ? AND photo_revision = ?', [filename, replacementId, userId, pointKey, expectedRevision])
    if (updated.affectedRows !== 1) throw photoConflict()
    committing = true
    await connection.commit()
    return { referenced: true, oldPath, duplicate: false }
  } catch (error) {
    if (committing) {
      // COMMIT may have reached MySQL despite loss of its acknowledgement. Never rollback + unlink blindly.
      connection.destroy(); destroyed = true
      let current
      try { current = await findCheckin(pool, userId, pointKey) } catch { throw uncertain() }
      if (current?.photo_revision === replacementId && current.photo_path === filename) return { referenced: true, oldPath, duplicate: false }
      // Even an old snapshot is not proof that an in-flight COMMIT cannot still finish.
      throw uncertain()
    }
    if (connection) {
      try { await connection.rollback() } catch { connection.destroy(); destroyed = true }
    }
    if (error instanceof HttpError) throw error
    console.error('Photo replacement transaction failed before COMMIT')
    throw unavailable()
  } finally { if (connection && !destroyed) connection.release() }
}

async function cleanup(filename, directory = false) {
  if (!filename) return
  try { await fs.rm(filename, { force: true, recursive: directory, maxRetries: 3, retryDelay: 100 }) }
  catch { console.error('Photo cleanup pending:', path.basename(filename)) }
}

export function mountPhotoReplacement(app, { pool, runtime, activityConfig }) {
  const requireUser = requireUserSession(pool, runtime)
  const limit = Math.min(maxPhotoBytes, activityConfig.rules.maxPhotoBytes)
  const receive = multer({ storage: multer.diskStorage({ destination: (req, _file, cb) => cb(null, req.photoTempDirectory), filename: (_req, _file, cb) => cb(null, 'source') }),
    limits: { fileSize: limit, files: 1, fields: 2, parts: 4, fieldNameSize: 32, fieldSize: 128, fieldNestingDepth: 0 } }).single('photo')
  app.get('/api/me/photos', requireUser, async (req, res) => {
    res.vary('Cookie')
    res.json({ ok: true, data: await photoInventory(pool, req.currentUser.id, activityConfig) })
  })
  app.put('/api/me/photos/:pointKey', requireUser, async (req, res) => {
    // A consistency guard only, never an identity selector: the session remains authoritative.
    if (req.get('x-photo-owner') && req.get('x-photo-owner') !== label(req.currentUser.id)) throw new HttpError(409, 'PHOTO_OWNER_CHANGED', '当前用户已变化，请重新读取照片')
    const origin = req.get('origin')
    if ((origin && origin !== runtime.publicOrigin) || req.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'INVALID_ORIGIN', '请从本活动页面上传照片')
    const pointKey = req.params.pointKey
    if (!activityConfig.points.some(point => point.key === pointKey)) throw new HttpError(404, 'INVALID_POINT', '地点不存在')
    if (!req.is('multipart/form-data')) throw new HttpError(400, 'INVALID_UPLOAD', '请选择一张现场照片')
    let directory, finalPath, keepPhoto = false, committed = false
    try {
      const root = path.join(runtime.uploadDir, '.tmp')
      await fs.mkdir(root, { recursive: true, mode: 0o700 })
      directory = await fs.mkdtemp(path.join(root, 'replace-'))
      req.photoTempDirectory = directory
      try { await new Promise((resolve, reject) => receive(req, res, error => error ? reject(error) : resolve())) }
      catch (error) {
        if (error.code === 'LIMIT_FILE_SIZE') throw new HttpError(413, 'IMAGE_TOO_LARGE', '照片不能超过 15 MiB')
        if (error instanceof multer.MulterError || /multipart|boundary|unexpected end/i.test(error.message)) throw new HttpError(400, 'INVALID_UPLOAD', '上传内容不完整或字段不正确')
        throw error
      }
      const { expectedRevision, replacementId } = req.body || {}
      if (Object.keys(req.body || {}).some(key => !['expectedRevision', 'replacementId'].includes(key)) || !validPhotoRevision(expectedRevision) || typeof replacementId !== 'string' || !replacementIdPattern.test(replacementId) || expectedRevision === replacementId) throw new HttpError(400, 'INVALID_REPLACEMENT', '修改标识或照片版本不正确，请重新核对')
      const inventory = await photoInventory(pool, req.currentUser.id, activityConfig)
      const saved = inventory.photos.find(photo => photo.pointKey === pointKey)
      if (!saved?.revision) throw new HttpError(404, 'PHOTO_NOT_FOUND', '尚无该地点记录，首次打卡仍需扫描地点码')
      if (saved.revision === replacementId) {
        await cleanup(directory, true); directory = null
        return res.json({ ok: true, data: inventory })
      }
      if (inventory.claimedAt) throw new HttpError(409, 'ALREADY_CLAIMED', '已领取礼品，照片只能查看，不能修改')
      if (!activityConfig.enabled) throw new HttpError(409, 'ACTIVITY_DISABLED', '活动暂未开放或已结束，照片只能查看')
      if (saved.revision !== expectedRevision) throw photoConflict()
      if (req.aborted || !req.file || !req.file.size) throw new HttpError(400, 'PHOTO_REQUIRED', '请选择一张现场照片')
      const processed = path.join(directory, 'processed.jpg')
      await processPhoto(req.file.path, processed)
      const filename = `${randomBytes(16).toString('hex')}.jpg`
      finalPath = storedPhotoPath(runtime.uploadDir, filename)
      await fs.rename(processed, finalPath)
      const result = await replacePhotoRecord(pool, { userId: req.currentUser.id, pointKey, expectedRevision, replacementId, filename, activity: activityConfig })
      keepPhoto = result.referenced
      committed = true
      if (result.oldPath) {
        try { await cleanup(storedPhotoPath(runtime.uploadDir, result.oldPath)) }
        catch { console.error('Previous photo cleanup pending: invalid stored basename') }
      }
      const data = await photoInventory(pool, req.currentUser.id, activityConfig)
      await cleanup(directory, true); directory = null
      if (!keepPhoto) { await cleanup(finalPath); finalPath = null }
      res.json({ ok: true, data })
    } catch (error) {
      if (error.preservePhoto) keepPhoto = true
      if (committed) throw uncertain()
      if (error instanceof HttpError) throw error
      console.error('Photo replacement upload failed before database commit')
      throw unavailable()
    } finally {
      await cleanup(directory, true)
      if (!keepPhoto) await cleanup(finalPath)
    }
  })
}
