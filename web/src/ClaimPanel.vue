<script setup>
import { onUnmounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { api, post } from './api.js'
import ClaimAction from './ClaimAction.vue'

const props = defineProps({ me: Object, activity: Object })
const emit = defineEmits(['state', 'busy', 'login-required'])
const qr = ref('')
const qrError = ref('')
let attempt = 0
async function makeQr() {
  const current = ++attempt
  qr.value = ''; qrError.value = ''
  if (!props.me.allCompleted || !props.me.claimUrl || props.me.claimedAt) return
  try {
    const image = await QRCode.toDataURL(props.me.claimUrl, { errorCorrectionLevel: 'M', margin: 4, width: 280 })
    if (current === attempt) qr.value = image
  } catch { if (current === attempt) qrError.value = '领取二维码暂时无法显示，请重试。' }
}
watch(() => [props.me.claimUrl, props.me.claimedAt], makeQr, { immediate: true })
onUnmounted(() => { attempt++ })
</script>

<template>
  <section class="claim-panel" aria-label="礼品领取">
    <h2>礼品领取</h2>
    <template v-if="me.allCompleted && !me.claimedAt">
      <p>{{ activity.claimLocationText }}</p>
      <p>出示本人领取二维码，或在实际拿到礼品后自行确认。仅打开凭证不会标记领取。</p>
      <img v-if="qr" class="claim-qr" :src="qr" alt="本人礼品领取二维码" />
      <p v-if="qrError" role="alert">{{ qrError }} <button type="button" @click="makeQr">重试二维码</button></p>
      <a v-if="me.claimUrl" :href="me.claimUrl" target="_blank" rel="noreferrer">查看领取凭证</a>
      <p class="notice">领取链接仅向现场派发人员出示；持此链接者可确认派发。</p>
    </template>
    <ClaimAction :state="me" :enabled="activity.enabled" label="我已领取礼品" confirm-label="确认已领取"
      confirmation="请在实际拿到礼品后确认。确认后将标记为已领取。"
      :submit="() => post('/api/me/claim', {})" :read-state="() => api('/api/me')"
      @state="emit('state', $event)" @busy="emit('busy', $event)" @login-required="emit('login-required', $event)" />
  </section>
</template>
