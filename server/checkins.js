import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import multer from 'multer'
import { HttpError } from './http.js'
import { requireUserSession, userProgress } from './identity.js'
import { findCheckin, maxPhotoBytes, processPhoto, storedPhotoPath } from './photos.js'

function validPoint(activity, key) {
  if (typeof key !== 'string' || !activity.points.some((point) => point.key === key)) {
    throw new HttpError(404, 'INVALID_POINT', '地点不存在，请重新扫描现场地点二维码')
  }
  return key
}
const uploadFailed = () => new HttpError(500, 'UPLOAD_FAILED', '照片暂时无法保存，请刷新状态后重试')

export function mountCheckins(app, { pool, runtime, activityConfig }) {
  const requireUser = requireUserSession(pool, runtime)
  const photoLimit = Math.min(maxPhotoBytes, activityConfig.rules.maxPhotoBytes)
  const upload = multer({
    storage: multer.diskStorage({
      destination: (request, _file, callback) => callback(null, request.photoTempDirectory),
      filename: (_request, _file, callback) => callback(null, 'source')
    }),
    limits: { fileSize: photoLimit, files: 1, fields: 1, parts: 3, fieldNameSize: 32, fieldSize: 128, fieldNestingDepth: 0 }
  }).single('photo')

  async function receiveAndSave(request, response) {
    const origin = request.get('origin')
    if ((origin && origin !== runtime.publicOrigin) || request.get('sec-fetch-site') === 'cross-site') {
      throw new HttpError(403, 'INVALID_ORIGIN', '请从本活动页面上传照片')
    }
    if (!activityConfig.enabled) throw new HttpError(409, 'ACTIVITY_DISABLED', '活动暂未开放或已结束')
    if (!request.is('multipart/form-data')) throw new HttpError(400, 'INVALID_UPLOAD', '请选择一张现场照片后提交')
    let directory, finalPath, filename
    let keepPhoto = false
    try {
      const tempRoot = path.join(runtime.uploadDir, '.tmp')
      await fs.mkdir(tempRoot, { recursive: true, mode: 0o700 })
      directory = await fs.mkdtemp(path.join(tempRoot, 'upload-'))
      request.photoTempDirectory = directory
      try {
        await new Promise((resolve, reject) => upload(request, response, (error) => error ? reject(error) : resolve()))
      } catch (error) {
        if (error.code === 'LIMIT_FILE_SIZE') throw new HttpError(413, 'IMAGE_TOO_LARGE', `照片不能超过 ${Math.round(photoLimit / 1024 / 1024)} MiB，请选择较小照片`)
        if (error instanceof multer.MulterError || /multipart|boundary|unexpected end/i.test(error.message)) {
          throw new HttpError(400, 'INVALID_UPLOAD', '上传内容不完整或字段不正确，请重新选择一张照片')
        }
        throw error
      }
      if (request.aborted) throw uploadFailed()
      const pointKey = validPoint(activityConfig, request.body?.pointKey)
      if (Object.keys(request.body).some((key) => key !== 'pointKey')) throw new HttpError(400, 'INVALID_UPLOAD', '上传字段不正确')
      // A successful record is immutable; a repeat returns the saved state without decoding/replacing its photo.
      if (await findCheckin(pool, request.currentUser.id, pointKey)) {
        return await userProgress(pool, request.currentUser, activityConfig, runtime.publicOrigin)
      }
      if (request.session.scannedPointKey !== pointKey) throw new HttpError(403, 'PLEASE_SCAN', '请先使用微信扫一扫或页面内扫一扫打开该地点码')
      if (!request.file || request.file.size === 0) throw new HttpError(400, 'PHOTO_REQUIRED', '请选择一张现场照片')
      const processed = path.join(directory, 'processed.jpg')
      await processPhoto(request.file.path, processed)
      // The configured activity set is stable during an event. Recheck the switch before the first write.
      if (!activityConfig.enabled) throw new HttpError(409, 'ACTIVITY_DISABLED', '活动暂未开放或已结束')
      filename = `${randomBytes(16).toString('hex')}.jpg`
      const target = storedPhotoPath(runtime.uploadDir, filename)
      await fs.rename(processed, target)
      finalPath = target
      try {
        await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path) VALUES (?, ?, ?)', [request.currentUser.id, pointKey, filename])
        keepPhoto = true
      } catch (error) {
        // UNIQUE(user_id, point_key) resolves races. Re-read also covers a lost INSERT acknowledgement.
        let existing
        try { existing = await findCheckin(pool, request.currentUser.id, pointKey) } catch {
          // Unknown commit outcome: do not destroy a possibly committed photo. Never claim success.
          keepPhoto = true
          console.error('Photo save outcome could not be confirmed; preserve file for reconciliation')
          throw uploadFailed()
        }
        keepPhoto = existing?.photo_path === filename
        if (!existing) throw error
      }
      return await userProgress(pool, request.currentUser, activityConfig, runtime.publicOrigin)
    } catch (error) {
      if (error instanceof HttpError) throw error
      console.error('Photo upload/storage failed')
      throw uploadFailed()
    } finally {
      // Only files made by this request; never the earlier winning record or another visitor's files.
      const cleanup = await Promise.allSettled([
        finalPath && !keepPhoto ? fs.rm(finalPath, { force: true }) : Promise.resolve(),
        directory ? fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) : Promise.resolve()
      ])
      if (cleanup.some((result) => result.status === 'rejected')) {
        console.error('Request photo cleanup failed; inspect local storage permissions')
        throw uploadFailed()
      }
    }
  }

  app.post('/api/checkins', requireUser, async (request, response) => {
    const state = await receiveAndSave(request, response)
    response.json({ ok: true, data: state })
  })

  app.get('/api/me/photos/:pointKey', requireUser, async (request, response) => {
    const pointKey = validPoint(activityConfig, request.params.pointKey)
    const record = await findCheckin(pool, request.currentUser.id, pointKey)
    if (!record) throw new HttpError(404, 'PHOTO_NOT_FOUND', '尚无该地点的照片记录')
    const filename = storedPhotoPath(runtime.uploadDir, record.photo_path)
    let file
    try {
      const stats = await fs.lstat(filename)
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Not a stored photo')
      file = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    } catch {
      throw new HttpError(410, 'PHOTO_MISSING', '照片已不可用，历史打卡记录仍然有效')
    }
    response.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="checkin.jpg"' })
    response.vary('Cookie')
    try { await pipeline(file.createReadStream(), response) } catch {
      if (!response.destroyed) response.destroy()
    } finally { await file.close() }
  })
}
