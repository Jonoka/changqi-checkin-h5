<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { api } from './api.js'
import { uploadWithRecovery } from './photo-upload.js'

const props = defineProps({ point: Object, me: Object, enabled: Boolean, scanned: Boolean, maxBytes: Number })
const emit = defineEmits(['state', 'busy', 'login-required', 'scan-required'])
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
  if (busy.value) return
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
        if (alive) { phase.value = 'verifying'; message.value = '正在核对本人保存结果…' }
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
watch(completed, (value) => { if (value) clearSelection(); void loadPhoto() }, { immediate: true })
onUnmounted(() => {
  alive = false
  photoAttempt++
  clearSelection()
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
  emit('busy', false)
})
</script>

<template>
  <div class="photo-panel" :data-phase="phase" :aria-busy="busy">
    <div v-if="phase === 'success' && completed" class="success-card" role="status"><span class="success-mark" aria-hidden="true">✓</span><div><h3>打卡成功</h3><p>{{ point.name }}的风景，已收进你的手记。</p><p>漫游进度 {{ me.completedCount }}/{{ me.totalCount }}<span v-if="me.allCompleted"> · 已完成全部地点，可查看领取凭证</span></p></div></div>
    <p class="privacy-note">照片用于本次活动打卡记录，不公开展示。</p>
    <template v-if="completed">
      <p>已保存本人现场照片；本期不提供修改、删除或补传。</p>
      <p v-if="photoLoading" role="status">正在读取本人照片…</p>
      <img v-if="photoUrl" class="photo-preview saved-photo" :src="photoUrl" :alt="`${point.name}：本人的打卡照片`" />
      <p v-if="photoMessage" role="status">{{ photoMessage }}</p>
      <button v-if="photoMessage" type="button" class="secondary" @click="loadPhoto">重试读取照片</button>
    </template>
    <template v-else-if="!enabled"><p>活动暂未开放或已结束，不能上传新照片。</p></template>
    <template v-else-if="!scanned"><p>请先使用页面内扫一扫识别该地点。刷新后尚未提交的照片需要重新选择；扫码信息未恢复时请重新扫码。</p></template>
    <template v-else>
      <label class="upload-label" :for="`photo-${point.key}`"><span class="camera-mark" aria-hidden="true">＋</span><strong>选择现场照片（可拍照或从相册选择）</strong></label>
      <input :id="`photo-${point.key}`" ref="input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" :disabled="busy || phase === 'unknown'" @change="choose" />
      <p class="upload-hint">仅一张 JPEG / PNG / WebP，最大 15 MiB。不支持的格式请重新拍照或转换为 JPG/PNG。提交前可重选，刷新会丢失未提交的选择。</p>
      <img v-if="preview" class="photo-preview local-preview" :src="preview" alt="待提交的现场照片预览" @error="message = '当前照片无法预览，请重新拍照或转换为 JPG/PNG'" />
      <p v-if="file">已选择：{{ file.name }}</p>
      <button type="button" :disabled="!file || busy || phase === 'unknown'" @click="submit">{{ busy ? '正在保存…' : '提交现场照片' }}</button>
      <button v-if="phase === 'unknown'" type="button" class="secondary" @click="verify">核对保存结果</button>
    </template>
    <p v-if="message" class="notice" :class="{ 'error-notice': ['error','unknown'].includes(phase), 'success-notice': phase === 'success' }" role="status">{{ message }}</p>
  </div>
</template>
