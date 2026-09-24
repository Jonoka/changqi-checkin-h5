<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from './api.js'
import { readPending, savePending, clearPending, fileDigest, replacementOutcome, replaceWithRecovery } from './photo-replacement.js'

const props = defineProps({ point: Object, me: Object, enabled: Boolean, maxBytes: Number, disabled: Boolean })
const emit = defineEmits(['busy', 'locked', 'editing', 'photo-state', 'login-required'])
const pending = ref(readPending(props.me.userLabel, props.point.key))
const editing = ref(Boolean(pending.value))
const phase = ref(pending.value ? 'unknown' : 'idle')
const record = ref(null)
const file = ref(null), preview = ref(''), input = ref(null), zoom = ref(null)
const photoUrl = ref(''), photoRevision = ref(''), photoLoading = ref(false), photoMessage = ref(''), message = ref('')
const busy = computed(() => ['uploading', 'verifying', 'refreshing'].includes(phase.value))
const canReplace = computed(() => props.enabled && !props.me.claimedAt && record.value?.canReplace)
let alive = true, photoAttempt = 0, inventoryAttempt = 0, controller, editRevision

function closeZoom() { if (zoom.value?.open) zoom.value.close() }
function clearPhoto() {
  closeZoom()
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
  photoUrl.value = ''; photoRevision.value = ''
}
function clearSelection() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''; file.value = null
  if (input.value) input.value.value = ''
}
function choose(event) {
  if (busy.value) return
  const chosen = event.target.files?.[0]
  if (!chosen) return
  clearSelection()
  if (!chosen.size || chosen.size > props.maxBytes) { message.value = '请选择非空且不超过 15 MiB 的照片'; return }
  file.value = chosen; preview.value = URL.createObjectURL(chosen)
  message.value = pending.value ? '仅能选择同一次修改的原文件，核对后以原标识重试。' : '新预览尚未提交；上方仍是当前已保存照片。'
  if (!pending.value) phase.value = 'editing'
}
async function readCurrent() {
  const attempt = ++inventoryAttempt, owner = props.me.userLabel
  const inventory = await api('/api/me/photos')
  if (!alive || attempt !== inventoryAttempt || owner !== props.me.userLabel) throw new Error('照片读取已过期，请重试')
  if (inventory.userLabel !== owner) {
    photoAttempt++; controller?.abort(); clearPhoto()
    throw Object.assign(new Error('当前用户已变化，请重新进入活动后核对'), { code: 'PHOTO_OWNER_CHANGED' })
  }
  return inventory
}
async function loadPhoto(revision, force = false) {
  if (!force && photoUrl.value && photoRevision.value === revision) return true
  const attempt = ++photoAttempt, owner = props.me.userLabel
  controller?.abort()
  const requestController = new AbortController()
  controller = requestController
  clearPhoto(); photoMessage.value = ''
  if (!revision) { photoMessage.value = '尚无该地点的已保存照片。'; return false }
  photoLoading.value = true
  // Keep cancellation + timeout without adding an AbortSignal.any requirement to WeChat webviews.
  const timeout = setTimeout(() => requestController.abort(), 12000)
  let url
  try {
    const query = new URLSearchParams({ revision, owner })
    const response = await fetch(`/api/me/photos/${encodeURIComponent(props.point.key)}?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: requestController.signal })
    if (!response.ok) {
      const payload = await response.json()
      throw Object.assign(new Error(payload.error?.message || '照片读取失败，请重试'), { code: payload.error?.code })
    }
    if (response.headers.get('x-photo-revision') !== revision || response.headers.get('x-photo-owner') !== owner || !response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('照片版本或用户不一致，请重新核对')
    const blob = await response.blob()
    if (!alive || attempt !== photoAttempt || owner !== props.me.userLabel) return false
    url = URL.createObjectURL(blob)
    const image = new Image(); image.src = url
    await image.decode()
    if (!alive || attempt !== photoAttempt || owner !== props.me.userLabel) return false
    photoUrl.value = url; url = null; photoRevision.value = revision
    return true
  } catch (error) {
    if (alive && attempt === photoAttempt) photoMessage.value = error.message || '照片读取失败，请重试'
    return false
  } finally {
    clearTimeout(timeout)
    if (url) URL.revokeObjectURL(url)
    if (alive && attempt === photoAttempt) photoLoading.value = false
  }
}
async function showCurrent(inventory, force = false) {
  if (!alive || inventory.userLabel !== props.me.userLabel) return false
  record.value = inventory.photos.find(photo => photo.pointKey === props.point.key) || null
  emit('photo-state', inventory)
  return loadPhoto(record.value?.revision, force)
}
async function refresh() {
  if (busy.value) return
  if (pending.value) return verify()
  const attempt = inventoryAttempt + 1
  photoMessage.value = ''; photoLoading.value = true
  try { await showCurrent(await readCurrent(), true) }
  catch (error) { if (alive && attempt === inventoryAttempt) photoMessage.value = error.message }
  finally { if (alive && attempt === inventoryAttempt) photoLoading.value = false }
}
function begin() {
  if (!canReplace.value || props.disabled || editing.value) return
  clearSelection(); editRevision = record.value.revision
  editing.value = true; phase.value = 'editing'; message.value = '上方照片保持不变，选择新照片后确认替换。'
}
function forgetOperation() { if (pending.value) clearPending(pending.value); pending.value = null }
function cancel() {
  if (busy.value || pending.value) return
  clearSelection(); editing.value = false; phase.value = 'idle'; message.value = ''
}
async function applyOutcome(result) {
  if (!alive) return
  if (result.kind === 'unknown') { phase.value = 'unknown'; message.value = result.message; return }
  phase.value = 'refreshing'
  const loaded = await showCurrent(result.inventory)
  if (!alive) return
  if (result.kind === 'success') {
    if (!loaded) { phase.value = 'unknown'; message.value = '服务器已确认本次版本，但新照片尚未读取成功，请继续核对。'; return }
    forgetOperation(); clearSelection(); editing.value = false; phase.value = 'success'
    message.value = '照片已替换，并已重新读取服务器保存的照片。'
  } else if (result.kind === 'conflict') {
    forgetOperation(); clearSelection(); phase.value = 'conflict'
    message.value = '照片已有其他版本，本次不能覆盖。请查看当前照片后结束核对。'
  } else if (result.kind === 'failed') {
    forgetOperation(); phase.value = 'error'
    message.value = result.message || '本次替换未保存，原照片和打卡记录保持不变。'
  } else {
    phase.value = 'unknown'
    message.value = '服务器仍是旧版本，不能认定新照片已保存。请继续核对，或选择同一文件重试本次修改。'
  }
}
async function submit() {
  if (busy.value || !file.value || (!pending.value && !canReplace.value)) return
  const priorUnknown = Boolean(pending.value)
  phase.value = 'uploading'; message.value = '正在保存替换照片，请勿离开或重复提交…'
  try {
    const hash = await fileDigest(file.value)
    if (pending.value && pending.value.fileHash !== hash) {
      phase.value = 'unknown'; message.value = '这不是本次修改的原文件。请重新选择同一文件，或继续核对结果。'; return
    }
    if (!pending.value) {
      const inventory = await readCurrent()
      const current = inventory.photos.find(photo => photo.pointKey === props.point.key)
      if (current?.revision !== editRevision || !current?.canReplace) {
        await showCurrent(inventory)
        phase.value = 'conflict'; message.value = '照片或领取状态已变化，请查看当前记录后结束核对。'; return
      }
      const operation = { v: 1, userLabel: props.me.userLabel, pointKey: props.point.key, expectedRevision: editRevision, replacementId: crypto.randomUUID(), fileHash: hash, view: location.hash === '#claim' ? 'claim' : 'point' }
      savePending(operation) // Store before the request; never store image bytes, Cookie or OpenID.
      pending.value = operation
    }
    const operation = { ...pending.value }
    const result = await replaceWithRecovery({ operation, priorUnknown,
      upload: () => {
        const body = new FormData()
        body.append('expectedRevision', operation.expectedRevision); body.append('replacementId', operation.replacementId); body.append('photo', file.value)
        return api(`/api/me/photos/${encodeURIComponent(operation.pointKey)}`, { method: 'PUT', headers: { 'x-photo-owner': operation.userLabel }, body, timeoutMs: 60000 })
      },
      readInventory: async () => { if (alive) phase.value = 'verifying'; return readCurrent() }
    })
    await applyOutcome(result)
  } catch (error) {
    if (alive) { phase.value = pending.value ? 'unknown' : 'error'; message.value = error.message }
  }
}
async function verify() {
  if (busy.value || !pending.value) return
  phase.value = 'verifying'; message.value = '正在核对照片版本…'
  try { await applyOutcome(replacementOutcome(await readCurrent(), pending.value)) }
  catch (error) { if (alive) { phase.value = 'unknown'; message.value = `仍无法确认替换结果：${error.message}。请继续核对，不要新建修改。` } }
}
function restore() {
  if (document.visibilityState === 'hidden' || busy.value) return
  if (pending.value) void verify()
  else if (!editing.value) void refresh()
}
watch(editing, value => emit('editing', value), { immediate: true, flush: 'sync' })
watch(busy, value => emit('busy', value), { immediate: true, flush: 'sync' })
watch(() => Boolean(pending.value), value => emit('locked', value), { immediate: true, flush: 'sync' })
watch(() => [props.me, props.enabled], () => { if (!editing.value && !busy.value) void refresh() })
// A restored pending edit can coincide with failed sibling loads. When it ends, retry those
// cards once; no polling and no unmount/remount of the still-unresolved editor.
watch(() => props.disabled, (value, previous) => {
  if (previous && !value && !editing.value && !busy.value && (!photoUrl.value || photoMessage.value)) void refresh()
})
onMounted(() => { restore(); window.addEventListener('pageshow', restore); document.addEventListener('visibilitychange', restore) })
onUnmounted(() => {
  alive = false; inventoryAttempt++; photoAttempt++; controller?.abort()
  clearPhoto(); clearSelection()
  // Unknown markers survive a reload. App blocks route unmount while editing/saving/unknown.
  emit('busy', false); emit('locked', false); emit('editing', false)
  window.removeEventListener('pageshow', restore); document.removeEventListener('visibilitychange', restore)
})
</script>

<template>
  <section class="saved-photo-panel" :data-phase="phase" :aria-busy="busy">
    <p class="saved-photo-label">当前已保存照片</p>
    <p v-if="photoLoading" role="status">正在读取服务器照片…</p>
    <img v-if="photoUrl" class="photo-preview saved-photo" :src="photoUrl" :data-photo-revision="photoRevision" :alt="`${point.name}：已保存的现场照片`" />
    <button v-if="photoUrl" type="button" class="secondary view-photo" @click="zoom.showModal()">查看大图</button>
    <p v-if="photoMessage" class="notice error-notice" role="status">{{ photoMessage }}</p>
    <button v-if="photoMessage" type="button" class="secondary" :disabled="busy" @click="refresh">重试读取照片</button>
    <dialog ref="zoom" class="photo-dialog" :aria-label="`${point.name}：照片大图`">
      <button type="button" class="close-photo" @click="closeZoom">关闭大图</button>
      <p>{{ point.name }} · 已保存照片</p>
      <img v-if="photoUrl" :src="photoUrl" :data-photo-revision="photoRevision" :alt="`${point.name}：完整现场照片`" />
    </dialog>
    <button v-if="canReplace && !editing" type="button" class="secondary change-photo" :disabled="disabled" @click="begin">重新拍摄 / 上传</button>
    <p v-if="me.claimedAt || !enabled" class="privacy-note">已领取或活动已关闭，照片仅可查看。</p>
    <section v-if="editing" class="replacement-editor" :aria-label="`修改${point.name}照片`">
      <h4>替换这一张照片</h4>
      <p class="privacy-note">当前照片保持不变。确认替换后，进度和原打卡时间不变。</p>
      <template v-if="phase !== 'conflict'">
        <figure v-if="preview" class="photo-selection"><img class="photo-preview local-preview" :src="preview" alt="待提交的新照片预览，尚未保存" /><figcaption>待提交的新预览 · {{ file?.name }}</figcaption></figure>
        <button v-if="pending" type="button" class="verify-button" :disabled="busy" @click="verify">核对替换结果</button>
        <button type="button" class="confirm-replacement" :disabled="busy || !file || (!pending && !canReplace)" @click="submit">{{ busy ? '正在保存 / 核对…' : pending ? '重试同一次替换' : '确认替换照片' }}</button>
        <div class="photo-picker" :class="{ 'has-selection': file, 'picker-locked': busy }">
          <input :id="`replacement-${point.key}`" ref="input" class="photo-input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" :disabled="busy" @change="choose" />
          <label class="upload-label" :for="`replacement-${point.key}`"><strong>{{ file ? '重新选择照片' : '上传现场照片' }}</strong><small v-if="!file">{{ pending ? '刷新后请重新选择本次修改的同一文件' : '拍照或从相册选择' }}</small></label>
        </div>
        <button type="button" class="secondary cancel-replacement" :disabled="busy || Boolean(pending)" @click="cancel">取消修改</button>
      </template>
      <button v-else type="button" class="secondary acknowledge-photo" :disabled="photoLoading" @click="cancel">{{ photoUrl ? '确认已查看当前照片' : '结束本次修改（照片仍不可用）' }}</button>
    </section>
    <p v-if="message" class="notice" :class="{ 'error-notice': ['error', 'unknown', 'conflict'].includes(phase), 'success-notice': phase === 'success' }" role="status">{{ message }}</p>
    <p class="privacy-note">照片不公开展示；现场人员可当面查看，系统不保存审核结果。</p>
  </section>
</template>
