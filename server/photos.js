import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { HttpError } from './http.js'

// One-off uploads must release their source handles, including on Windows.
sharp.cache({ files: 0, items: 0, memory: 32 })

export const maxPhotoBytes = 15 * 1024 * 1024
const unsupported = () => new HttpError(415, 'UNSUPPORTED_IMAGE', '照片无法解码或格式不支持，请重新拍照或转换为 JPG/PNG 后重试')

// Inspect actual bytes, never trust the original name or browser MIME type. Strip metadata on output.
export async function processPhoto(input, output) {
  const image = sharp(input, { failOn: 'warning', limitInputPixels: 80000000, sequentialRead: true })
  let jpeg
  try {
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw unsupported()
    jpeg = await image.autoOrient().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer()
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ENOENT'].includes(error.code)) throw error
    throw unsupported()
  } finally { image.destroy() }
  // Only the bounded, resized JPEG is buffered. Disk failures are not mistaken for unsupported images.
  await fs.writeFile(output, jpeg, { flag: 'wx', mode: 0o600 })
}

export function storedPhotoPath(directory, filename) {
  // Only our random, server-generated basenames are ever read, even if a DB row is malformed.
  if (typeof filename !== 'string' || !/^[a-f0-9]{32}\.jpg$/.test(filename)) {
    throw new HttpError(410, 'PHOTO_MISSING', '照片已不可用，历史打卡记录仍然有效')
  }
  return path.join(directory, filename)
}

export async function findCheckin(pool, userId, pointKey) {
  const [rows] = await pool.execute('SELECT photo_path FROM checkins WHERE user_id = ? AND point_key = ?', [userId, pointKey])
  return rows[0] || null
}
