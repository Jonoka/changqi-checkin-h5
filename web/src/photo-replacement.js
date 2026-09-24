const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const revision = value => value === 'initial' || (typeof value === 'string' && uuid.test(value))
const key = (owner, point) => `changqi.photo-replacement:${owner}:${point}`
const valid = (value, owner, point) => value?.v === 1 && value.userLabel === owner && value.pointKey === point && /^CQ\d+$/.test(owner) && /^[A-Za-z0-9_-]{1,32}$/.test(point) && revision(value.expectedRevision) && uuid.test(value.replacementId) && value.expectedRevision !== value.replacementId && /^[a-f0-9]{64}$/.test(value.fileHash) && ['claim', 'point'].includes(value.view)
export function readPending(owner, point, storage) {
  try { storage ||= globalThis.sessionStorage; const value = JSON.parse(storage.getItem(key(owner, point))); return valid(value, owner, point) ? value : null } catch { return null }
}
export function savePending(value, storage) {
  if (!valid(value, value.userLabel, value.pointKey)) throw new Error('修改核对标记无效')
  try {
    storage ||= globalThis.sessionStorage
    const text = JSON.stringify(value)
    storage.setItem(key(value.userLabel, value.pointKey), text)
    if (storage.getItem(key(value.userLabel, value.pointKey)) !== text) throw new Error('unavailable')
  } catch { throw new Error('无法保存待核对标记，请允许页面存储后重试；尚未提交照片') }
}
export function clearPending(value, storage) {
  try { storage ||= globalThis.sessionStorage; storage.removeItem(key(value.userLabel, value.pointKey)) } catch { /* Retaining a marker only causes a safe read on reload. */ }
}
export function firstPending(owner, points) { return points.map(point => readPending(owner, point.key)).find(Boolean) || null }
export async function fileDigest(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export function replacementOutcome(inventory, operation) {
  if (inventory?.userLabel !== operation.userLabel) throw Object.assign(new Error('当前用户已变化，请重新进入活动后核对'), { code: 'PHOTO_OWNER_CHANGED' })
  const photo = inventory.photos?.find(item => item.pointKey === operation.pointKey)
  if (photo?.revision === operation.replacementId) return { kind: 'success', inventory }
  if (photo?.revision !== operation.expectedRevision) return { kind: 'conflict', inventory }
  if (inventory.claimedAt || !inventory.enabled) return { kind: 'failed', inventory, message: '照片版本未变，已领取或活动已关闭，不能继续修改。' }
  return { kind: 'pending', inventory }
}
const definiteFailures = new Set(['REPLACEMENT_FAILED', 'UNSUPPORTED_IMAGE', 'IMAGE_TOO_LARGE', 'INVALID_UPLOAD', 'INVALID_REPLACEMENT', 'PHOTO_REQUIRED', 'INVALID_ORIGIN'])
export async function replaceWithRecovery({ operation, upload, readInventory, priorUnknown = false }) {
  let cause
  try {
    const result = replacementOutcome(await upload(), operation)
    if (result.kind !== 'pending') return result
  } catch (error) { cause = error }
  let inventory
  try { inventory = await readInventory() }
  catch { return { kind: 'unknown', message: '仍无法确认替换结果，请继续核对，不要新建修改或领取。' } }
  try {
    const result = replacementOutcome(inventory, operation)
    // An old record alone never confirms a replacement. A prior unresolved attempt may still run.
    if (result.kind === 'pending' && !priorUnknown && definiteFailures.has(cause?.code)) return { kind: 'failed', inventory, message: cause.message }
    return result
  } catch (error) { return { kind: 'unknown', message: error.message } }
}
