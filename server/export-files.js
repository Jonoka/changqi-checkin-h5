import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { storedPhotoPath, maxPhotoBytes } from './photos.js'
import { validPhotoRevision } from './photo-replacement.js'
import { reportError, cqLabel } from './activity-reports.js'

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MAX_COPY_ATTEMPTS = 3
export const within = (parent, child) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}
export function safeName(value) {
  let result = Array.from(String(value).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim()).slice(0, 60).join('').replace(/[. ]+$/g, '')
  if (!result || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(result)) result = `地点_${result || '未命名'}`
  return result
}
export function photoRelativePath(photo, name) {
  if (cqLabel(photo.userId) !== photo.cq || !/^[A-Za-z0-9_-]{1,32}$/.test(photo.pointKey)) throw reportError('UNSAFE_OUTPUT_NAME')
  return `photos/${photo.cq}/${photo.pointKey}-${safeName(name)}.jpg`
}

export async function directoryIdentity(directory, io = fs) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root
  let current = root
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const stat = await io.lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw reportError('UNSAFE_DIRECTORY')
  }
  const actual = await io.realpath(absolute)
  const stat = await io.stat(actual)
  return { path: actual, dev: stat.dev, ino: stat.ino }
}
export async function sameDirectory(identity, io = fs) {
  const current = await directoryIdentity(identity.path, io)
  if (current.path !== identity.path || current.dev !== identity.dev || current.ino !== identity.ino) throw reportError('DIRECTORY_CHANGED')
}
export async function prepareOutput(out, uploadDir, io = fs) {
  if (typeof out !== 'string' || !path.isAbsolute(out) || /[\u0000-\u001f]/.test(out)) throw reportError('ABSOLUTE_NEW_OUTPUT_REQUIRED')
  if (typeof uploadDir !== 'string' || !path.isAbsolute(uploadDir)) throw reportError('ABSOLUTE_UPLOAD_DIR_REQUIRED')
  const resolved = path.resolve(out), name = path.basename(resolved)
  if (!name || safeName(name) !== name) throw reportError('UNSAFE_BATCH_NAME')
  const parent = await directoryIdentity(path.dirname(resolved), io)
  const upload = await directoryIdentity(uploadDir, io)
  const project = await directoryIdentity(sourceRoot, io)
  const target = path.join(parent.path, name)
  for (const forbidden of [project.path, upload.path]) {
    if (within(forbidden, target) || within(target, forbidden)) throw reportError('OUTPUT_OVERLAPS_SOURCE')
  }
  try { await io.lstat(target); throw reportError('OUTPUT_ALREADY_EXISTS') } catch (error) { if (error.code !== 'ENOENT') throw error }
  await io.access(parent.path, constants.W_OK)
  return { target, parent, upload }
}
export async function freeBytes(directory, io = fs) {
  const stat = await io.statfs(directory, { bigint: true })
  return BigInt(stat.bavail) * BigInt(stat.bsize)
}

export async function openSource(upload, basename, io = fs) {
  await sameDirectory(upload, io)
  let filename
  try { filename = storedPhotoPath(upload.path, basename) } catch { throw reportError('UNSAFE_PHOTO_PATH') }
  let handle
  try {
    const before = await io.lstat(filename)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw reportError('UNSAFE_PHOTO_FILE')
    handle = await io.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const opened = await handle.stat()
    const after = await io.lstat(filename)
    if (!after.isFile() || after.isSymbolicLink() || opened.dev !== before.dev || opened.ino !== before.ino || opened.dev !== after.dev || opened.ino !== after.ino || opened.nlink !== 1) throw reportError('SOURCE_CHANGED')
    if (opened.size < 4 || opened.size > maxPhotoBytes) throw reportError('INVALID_JPEG')
    const head = Buffer.alloc(2), tail = Buffer.alloc(2)
    await handle.read(head, 0, 2, 0); await handle.read(tail, 0, 2, opened.size - 2)
    if (head[0] !== 0xff || head[1] !== 0xd8 || tail[0] !== 0xff || tail[1] !== 0xd9) throw reportError('INVALID_JPEG')
    return { handle, filename, stat: opened }
  } catch (error) { if (handle) await handle.close(); throw error }
}

export async function committedPhoto(pool, photo) {
  let rows
  try {
    ;[rows] = await pool.execute({ sql: 'SELECT photo_path, photo_revision, created_at FROM checkins WHERE user_id = ? AND BINARY point_key = ?', timeout: 15000 }, [photo.userId, photo.pointKey])
  } catch { throw reportError('DATABASE_UNAVAILABLE') }
  if (!rows[0]) throw reportError('RECORD_MISSING')
  if (!validPhotoRevision(rows[0].photo_revision)) throw reportError('INVALID_PHOTO_REVISION')
  return rows[0]
}

// Only the private batch directory's temporary path can be removed here. Sources are never removed.
export async function copyCurrentPhoto({ pool, photo, upload, batch, relativePath, reserveBytes = 1048576n, signal, io = fs, hooks = {} }) {
  const target = path.resolve(batch.path, relativePath)
  if (!within(batch.path, target) || path.relative(batch.path, target).startsWith('..')) throw reportError('UNSAFE_OUTPUT_NAME')
  const temporary = `${target}.part`
  let lastError
  for (let attempt = 1; attempt <= MAX_COPY_ATTEMPTS; attempt++) {
    let source, destination, ownsTemporary = false
    try {
      signal?.throwIfAborted()
      await sameDirectory(batch, io)
      await directoryIdentity(path.dirname(target), io)
      const before = await committedPhoto(pool, photo)
      source = await openSource(upload, before.photo_path, io)
      if (await freeBytes(batch.path, io) < BigInt(source.stat.size) + reserveBytes) throw reportError('INSUFFICIENT_SPACE')
      await hooks.beforeCopy?.({ attempt, photo, before })
      destination = await io.open(temporary, 'wx', 0o600); ownsTemporary = true
      const hash = createHash('sha256'); let bytes = 0
      // Bounded streaming copy with explicit handle ownership. In particular, no Windows
      // FileHandle.close() waits on a still-associated autoClose:false stream.
      const buffer = Buffer.alloc(64 * 1024)
      while (true) {
        signal?.throwIfAborted()
        const { bytesRead } = await source.handle.read(buffer, 0, buffer.length, bytes)
        if (!bytesRead) break
        if (bytes + bytesRead > maxPhotoBytes) throw reportError('SOURCE_CHANGED')
        hash.update(buffer.subarray(0, bytesRead))
        let written = 0
        while (written < bytesRead) {
          signal?.throwIfAborted()
          const result = await destination.write(buffer, written, bytesRead - written, bytes + written)
          if (!result.bytesWritten) throw reportError('OUTPUT_WRITE_FAILED')
          written += result.bytesWritten
        }
        bytes += bytesRead
      }
      await destination.sync()
      const afterFile = await source.handle.stat()
      await destination.close(); destination = null
      await source.handle.close(); source.handle = null
      await hooks.afterCopy?.({ attempt, photo, before })
      signal?.throwIfAborted()
      const after = await committedPhoto(pool, photo)
      if (before.photo_path !== after.photo_path || before.photo_revision !== after.photo_revision) throw reportError('SOURCE_CHANGED')
      await sameDirectory(upload, io)
      // An open descriptor can survive pathname removal on some filesystems. Recheck
      // the name as well, so disappearance/rebinding cannot be labelled a stable copy.
      const namedAfter = await io.lstat(source.filename)
      if (!namedAfter.isFile() || namedAfter.isSymbolicLink() || namedAfter.nlink !== 1) throw reportError('UNSAFE_PHOTO_FILE')
      if (namedAfter.dev !== source.stat.dev || namedAfter.ino !== source.stat.ino || namedAfter.size !== source.stat.size || namedAfter.mtimeMs !== source.stat.mtimeMs) throw reportError('SOURCE_CHANGED')
      if (source.stat.size !== bytes || afterFile.size !== source.stat.size || afterFile.mtimeMs !== source.stat.mtimeMs) throw reportError('SOURCE_CHANGED')
      await sameDirectory(batch, io)
      await directoryIdentity(path.dirname(target), io)
      // link fails if the target exists; unlike rename it cannot silently overwrite anything.
      await io.link(temporary, target)
      await io.unlink(temporary); ownsTemporary = false
      return { actualRevision: before.photo_revision, bytes, sha256: hash.digest('hex'), attempts: attempt }
    } catch (error) {
      lastError = error
      error.attempts = attempt
      if (['DATABASE_UNAVAILABLE', 'INSUFFICIENT_SPACE', 'ENOSPC', 'EDQUOT', 'EROFS', 'DIRECTORY_CHANGED', 'UNSAFE_DIRECTORY'].includes(error.code) || signal?.aborted || error.name === 'AbortError') throw error
      // Invalid sources never become safe by retrying the same unsafe path. Missing/changed files may recover.
      if (!['ENOENT', 'SOURCE_CHANGED', 'RECORD_MISSING', 'EBUSY'].includes(error.code)) throw error
    } finally {
      if (destination) await destination.close()
      if (source?.handle) await source.handle.close()
      if (ownsTemporary) await io.unlink(temporary)
    }
  }
  throw lastError
}
