<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { api } from './api.js'
import { uploadWithRecovery } from './photo-upload.js'

const props = defineProps({ point: Object, me: Object, enabled: Boolean, scanned: Boolean, maxBytes: Number })
const emit = defineEmits(['state', 'busy', 'locked', 'login-required', 'scan-required', 'continue', 'claim'])
const file = ref(null)
const preview = ref('')
const input = ref(null)
const phase = ref('idle')
const message = ref('')
const photoUrl = ref('')
const photoMessage = ref('')
const photoLoading = ref(false)
const completed = computed(() => props.me.completedKeys.includes(props.point.key))
const busy = computed(() => ['uploading', 'verifying'].includes(phase.value))
let alive = true
let photoAttempt = 0

function clearSelection() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''
  file.value = null
  if (input.value) input.value.value = ''
}
function choose(event) {
  if (busy.value || phase.value === 'unknown') return
  const chosen = event.target.files?.[0]
  if (!chosen) return // Native picker cancellation preserves the previous selection.
  clearSelection()
  message.value = ''
  if (chosen.size === 0) { message.value = '照片为空，请重新选择'; return }
  if (chosen.size > props.maxBytes) { message.value = '照片不能超过 15 MiB，请选择较小照片'; return }
  file.value = chosen
  preview.value = URL.createObjectURL(chosen)
  phase.value = 'idle'
}
function handleError(error) {
  if (error.code === 'NEED_LOGIN') emit('login-required', error)
  if (error.code === 'PLEASE_SCAN') emit('scan-required')
  if (error.currentState) emit('state', error.currentState)
  phase.value = error.code === 'VERIFY_REQUIRED' ? 'unknown' : 'error'
  message.value = error.message
}
async function submit() {
  if (busy.value || phase.value === 'unknown' || !file.value || !props.scanned || !props.enabled || completed.value) return
  phase.value = 'uploading'
  emit('busy', true)
  message.value = '正在上传并保存，请勿重复提交…'
  const pointKey = props.point.key
  try {
    const result = await uploadWithRecovery({
      pointKey, file: file.value,
      upload: async (key, photo) => {
        const body = new FormData()
        body.append('pointKey', key)
        body.append('photo', photo)
        return api('/api/checkins', { method: 'POST', body, timeoutMs: 60000 })
      },
      readState: async () => {
        if (alive) { phase.value = 'verifying'; message.value = '正在核对保存结果…' }
        return api('/api/me')
      }
    })
    if (!alive) return
    emit('state', result.state)
    clearSelection()
    phase.value = 'success'
    message.value = result.recovered ? '已从服务器确认保存成功，无需重复上传。' : '照片保存成功，该地点已完成。'
  } catch (error) { if (alive) handleError(error) }
  finally { if (alive) { if (busy.value) phase.value = 'error'; emit('busy', false) } }
}
async function verify() {
  if (busy.value) return
  phase.value = 'verifying'
  emit('busy', true)
  try {
    const state = await api('/api/me')
    if (!alive) return
    emit('state', state)
    if (state.completedKeys.includes(props.point.key)) {
      clearSelection(); phase.value = 'success'; message.value = '已确认保存成功，无需重复上传。'
    } else {
      phase.value = 'idle'; message.value = '服务器尚无该地点记录，可重新提交；重复请求不会覆盖首张成功照片。'
    }
  } catch (error) {
    if (alive) {
      if (error.code !== 'NEED_LOGIN') {
        error.code = 'VERIFY_REQUIRED'
        error.message = '仍无法确认保存结果，请检查连接后再次核对，不要重复提交'
      }
      handleError(error)
    }
  } finally { if (alive) emit('busy', false) }
}
async function loadPhoto() {
  const attempt = ++photoAttempt
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
  photoUrl.value = ''
  photoMessage.value = ''
  if (!completed.value) return
  photoLoading.value = true
  try {
    const response = await fetch(`/api/me/photos/${encodeURIComponent(props.point.key)}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000) })
    if (!response.ok) {
      const payload = await response.json()
      const error = new Error(payload.error?.message || '照片暂时无法读取，请重试')
      error.code = payload.error?.code
      throw error
    }
    if (!response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('照片响应异常，请重试')
    const blob = await response.blob()
    if (alive && attempt === photoAttempt) photoUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    if (alive && attempt === photoAttempt) {
      photoMessage.value = error.message || '照片暂时无法读取，请重试'
      if (error.code === 'NEED_LOGIN') emit('login-required', error)
    }
  } finally { if (alive && attempt === photoAttempt) photoLoading.value = false }
}
// Keep the existing recovery state mounted when hash/back navigation is attempted.
watch(phase, value => emit('locked', value === 'unknown'), { flush: 'sync' })
watch(completed, (value) => { if (value) clearSelection(); void loadPhoto() }, { immediate: true })
onUnmounted(() => {
  alive = false
  photoAttempt++
  clearSelection()
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
  emit('busy', false)
  emit('locked', false)
})
</script>

<template>
  <div class="photo-panel" :data-phase="phase" :aria-busy="busy">
    <div v-if="completed" class="success-card" role="status">
      <div class="success-copy"><span class="success-mark" aria-hidden="true">✓</span><div><h3>{{ phase === 'success' ? '打卡成功' : '本站已完成' }}</h3><p>{{ point.name }} · 已保存现场照片</p></div></div>
      <p v-if="me.claimedAt">已领取礼品，感谢参与这次漫游。</p><p v-else-if="!enabled">活动已结束，已有记录仍可查看。</p><p v-else-if="me.allCompleted">全部地点已完成，可以查看领取凭证。</p>
      <button v-if="me.allCompleted && enabled && !me.claimedAt" type="button" class="success-next" @click="emit('claim')">查看领取凭证</button>
      <button v-else type="button" class="success-next" @click="emit('continue')">{{ me.claimedAt ? '返回地图' : '继续探索' }}</button>
    </div>
    <template v-if="completed">
      <p v-if="photoLoading" role="status">正在读取照片…</p>
      <img v-if="photoUrl" class="photo-preview saved-photo" :src="photoUrl" :alt="`${point.name}：打卡照片`" />
      <p v-if="photoMessage" role="status">{{ photoMessage }}</p>
      <button v-if="photoMessage" type="button" class="secondary" @click="loadPhoto">重试读取照片</button>
      <p class="privacy-note">照片不公开展示；已完成地点不替换照片。</p>
    </template>
    <template v-else-if="!enabled"><p>活动暂未开放或已结束，不能上传新照片。</p></template>
    <template v-else-if="!scanned"><p class="muted">请先使用微信扫一扫或页面内扫一扫打开该地点码。</p><slot name="scan" /><details class="upload-help"><summary>刷新或返回后没有照片？</summary><p>未提交的照片需要重新选择。若本站资格尚未恢复，请扫描本站地点码重新进入。</p></details></template>
    <div v-else class="upload-form">
      <figure v-if="preview" class="photo-selection"><img class="photo-preview local-preview" :src="preview" alt="待提交的现场照片预览" @error="message = '当前照片无法预览，请重新拍照或转换为 JPG/PNG'" /><figcaption v-if="file">已选择：{{ file.name }}</figcaption></figure>
      <button v-if="phase === 'unknown'" type="button" class="verify-button" @click="verify">核对保存结果</button>
      <button v-if="file || busy || phase === 'unknown'" type="button" :class="{ secondary: phase === 'unknown' }" :disabled="!file || busy || phase === 'unknown'" @click="submit">{{ busy ? '正在保存…' : '提交现场照片' }}</button>
      <div class="photo-picker" :class="{ 'has-selection': file, 'picker-locked': busy || phase === 'unknown' }">
        <input :id="`photo-${point.key}`" ref="input" class="photo-input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" :aria-describedby="`photo-help-${point.key}`" :disabled="busy || phase === 'unknown'" @change="choose" />
        <label class="upload-label" :for="`photo-${point.key}`" :aria-disabled="busy || phase === 'unknown'">
          <svg v-if="!file" class="camera-mark" viewBox="0 0 40 32" aria-hidden="true"><path d="M4 8h8l3-5h10l3 5h8v21H4Z"/><circle cx="20" cy="18" r="7"/></svg>
          <strong>{{ file ? '重新选择照片' : '上传现场照片' }}</strong><small v-if="!file">拍照或从相册选择</small>
        </label>
      </div>
      <p class="privacy-note">照片仅用于本次活动记录，不公开展示。</p>
      <details class="upload-help"><summary>照片要求与说明</summary><p :id="`photo-help-${point.key}`">一张 JPEG / PNG / WebP，最大 {{ Math.round(maxBytes / 1024 / 1024 * 10) / 10 }} MiB。不支持的格式请重新拍照或转换为 JPG/PNG。</p><p>提交前可以重选。刷新会恢复已保存记录与当前有效地点，但未提交的照片需要重新选择。</p></details>
    </div>
    <p v-if="message" class="notice" :class="{ 'error-notice': ['error','unknown'].includes(phase), 'success-notice': phase === 'success' }" role="status">{{ message }}</p>
  </div>
</template>
