<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { claimWithRecovery } from './claim-action.js'

const props = defineProps({ state: Object, enabled: Boolean, blocked: Boolean, label: String, confirmation: String, confirmLabel: String, submit: Function, readState: Function })
const emit = defineEmits(['state', 'busy', 'locked', 'login-required'])
const phase = ref('idle')
const message = ref('')
const confirming = ref(false)
const busy = computed(() => ['saving', 'verifying'].includes(phase.value))
const allowed = computed(() => !props.blocked && props.enabled && props.state.allCompleted && !props.state.claimedAt)
let alive = true
function report(error, verifying = false) {
  if (error.code === 'NEED_LOGIN') emit('login-required', error)
  if (error.currentState) emit('state', error.currentState)
  phase.value = verifying || error.code === 'VERIFY_REQUIRED' ? 'unknown' : 'error'
  message.value = verifying ? '仍无法确认领取结果，请继续核对，不要重复派发礼品。' : error.message
}
async function confirm() {
  if (!confirming.value || !allowed.value || busy.value || phase.value === 'unknown') return
  confirming.value = false
  phase.value = 'saving'; message.value = '正在保存领取状态…'; emit('busy', true)
  try {
    const result = await claimWithRecovery({ submit: props.submit, readState: async () => {
      if (alive) phase.value = 'verifying'
      return props.readState()
    } })
    if (!alive) return
    emit('state', result.state)
    phase.value = 'success'
    message.value = result.recovered ? '已从服务器确认领取成功，无需重复操作。' : '领取状态已保存。'
  } catch (error) { if (alive) report(error) }
  finally { if (alive) emit('busy', false) }
}
async function verify() {
  if (busy.value) return
  phase.value = 'verifying'; emit('busy', true)
  try {
    const state = await props.readState()
    if (!alive) return
    emit('state', state)
    phase.value = state.claimedAt ? 'success' : 'idle'
    message.value = state.claimedAt ? '已确认领取成功，无需重复操作。' : '服务器尚未标记领取，请核实实物交付后再确认。'
  } catch (error) { if (alive) report(error, true) }
  finally { if (alive) emit('busy', false) }
}
watch(phase, value => emit('locked', value === 'unknown'), { flush: 'sync' })
watch(() => props.state.claimedAt, (value) => { if (value) confirming.value = false })
watch(() => props.blocked, value => { if (value) confirming.value = false })
onUnmounted(() => { alive = false; emit('busy', false); emit('locked', false) })
</script>

<template>
  <div class="claim-action" :data-phase="phase" :aria-busy="busy">
    <p v-if="state.claimedAt" class="claimed-status" role="status">已领取 · 首次确认时间：{{ state.claimedAt }}</p>
    <template v-else>
      <p v-if="!state.allCompleted">尚未完成全部地点，暂不能领取礼品。</p>
      <p v-else-if="!enabled">活动暂未开放或已结束，不能首次确认领取。</p>
      <button v-if="phase === 'unknown'" type="button" class="verify-button" @click="verify">核对领取结果</button>
      <button v-if="state.allCompleted && enabled && !confirming" type="button" :class="{ secondary: phase === 'unknown' }" :disabled="!allowed || busy || phase === 'unknown'" @click="confirming = true">{{ busy ? '正在核对领取…' : label }}</button>
      <section v-if="confirming && allowed" class="claim-confirm" role="dialog" aria-label="确认领取操作">
        <p>{{ confirmation }}</p>
        <button type="button" @click="confirm">{{ confirmLabel }}</button>
        <button type="button" class="secondary" @click="confirming = false">取消</button>
      </section>
    </template>
    <p v-if="message" class="notice" :class="{ 'error-notice': ['error','unknown'].includes(phase), 'success-notice': phase === 'success' }" role="status">{{ message }}</p>
  </div>
</template>
