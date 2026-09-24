import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { replacementOutcome, replaceWithRecovery, readPending, savePending, clearPending } from '../web/src/photo-replacement.js'
import { validPhotoRevision } from '../server/photo-replacement.js'

const op = () => ({ v: 1, userLabel: 'CQ000123', pointKey: 'p01', expectedRevision: 'initial', replacementId: randomUUID(), fileHash: 'a'.repeat(64), view: 'claim' })
const inventory = (operation, revision = operation.expectedRevision, overrides = {}) => ({ userLabel: operation.userLabel, enabled: true, claimedAt: null, photos: [{ pointKey: operation.pointKey, revision, canReplace: true }], ...overrides })
const failed = code => Object.assign(new Error(code), { code })
test('Replacement: only the operation revision proves success; completedKeys is irrelevant', () => {
  const operation = op()
  assert.equal(replacementOutcome({ ...inventory(operation), completedKeys: ['p01'] }, operation).kind, 'pending')
  assert.equal(replacementOutcome(inventory(operation, operation.replacementId), operation).kind, 'success')
  assert.equal(replacementOutcome(inventory(operation, randomUUID()), operation).kind, 'conflict')
  assert.throws(() => replacementOutcome(inventory(operation, 'initial', { userLabel: 'CQ999999' }), operation), { code: 'PHOTO_OWNER_CHANGED' })
})
test('Replacement: response loss confirms exact ID with one upload, never a blind second write', async () => {
  const operation = op(); let uploads = 0
  const result = await replaceWithRecovery({ operation, upload: async () => { uploads++; throw new Error('SIMULATED lost response') }, readInventory: async () => inventory(operation, operation.replacementId) })
  assert.equal(result.kind, 'success'); assert.equal(uploads, 1)
})
test('Replacement: old saved record and repeated failed verification never produce false success', async () => {
  const operation = op()
  for (let n = 0; n < 3; n++) {
    assert.equal((await replaceWithRecovery({ operation, upload: async () => { throw new Error('timeout') }, readInventory: async () => inventory(operation), priorUnknown: n > 0 })).kind, 'pending')
    assert.equal((await replaceWithRecovery({ operation, upload: async () => { throw new Error('timeout') }, readInventory: async () => { throw new Error('offline') }, priorUnknown: true })).kind, 'unknown')
  }
})
test('Replacement: a known failure is editable only without an older unresolved attempt', async () => {
  const operation = op()
  const options = { operation, upload: async () => { throw failed('REPLACEMENT_FAILED') }, readInventory: async () => inventory(operation) }
  assert.equal((await replaceWithRecovery(options)).kind, 'failed')
  assert.equal((await replaceWithRecovery({ ...options, priorUnknown: true })).kind, 'pending')
  assert.equal((await replaceWithRecovery({ ...options, upload: async () => { throw failed('REPLACEMENT_UNCERTAIN') } })).kind, 'pending')
})
test('Replacement: another revision is conflict; claimed/closed old revision cannot imply success', () => {
  const operation = op()
  assert.equal(replacementOutcome(inventory(operation, randomUUID()), operation).kind, 'conflict')
  assert.equal(replacementOutcome(inventory(operation, 'initial', { claimedAt: '2026-09-24T12:00:00+08:00' }), operation).kind, 'failed')
  assert.equal(replacementOutcome(inventory(operation, 'initial', { enabled: false }), operation).kind, 'failed')
})
test('Replacement: reload markers are owner/point scoped, bounded metadata and never identity', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const operation = op(); savePending(operation, storage)
  assert.deepEqual(readPending(operation.userLabel, operation.pointKey, storage), operation)
  assert.equal(readPending('CQ000124', operation.pointKey, storage), null)
  assert.equal(readPending(operation.userLabel, 'p02', storage), null)
  assert.doesNotMatch([...values.values()][0], /openid|cookie|data:image|photo_path/i)
  clearPending(operation, storage); assert.equal(values.size, 0)
  assert.throws(() => savePending(operation, { setItem() { throw new Error('blocked') } }), /尚未提交/)
  assert.throws(() => savePending({ ...operation, expectedRevision: '../file' }, storage), /无效/)
})
test('Replacement: initial/UUID revisions are accepted, paths, arrays and malformed IDs rejected', () => {
  assert.equal(validPhotoRevision('initial'), true); assert.equal(validPhotoRevision(randomUUID()), true)
  for (const value of [null, '', [], '../photo.jpg', 'A'.repeat(36), randomUUID().toUpperCase()]) assert.equal(validPhotoRevision(value), false)
})
