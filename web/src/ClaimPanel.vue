<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { api, post } from './api.js'
import ClaimAction from './ClaimAction.vue'
import PhotoPanel from './PhotoPanel.vue'
import { firstPending } from './photo-replacement.js'

const props = defineProps({ me: Object, activity: Object })
const emit = defineEmits(['state', 'busy', 'locked', 'login-required', 'photo-busy', 'photo-locked', 'editing', 'photo-state'])
const points = computed(() => [...props.activity.points].sort((a, b) => a.displayOrder - b.displayOrder))
const photoStates = reactive({})
const restored = firstPending(props.me.userLabel, props.activity.points)
if (restored) photoStates[restored.pointKey] = { editing: true, locked: true }
const any = field => Object.values(photoStates).some(state => state[field])
const photoBlocked = computed(() => any('editing') || any('busy') || any('locked'))
const claimBusy = ref(false), claimLocked = ref(false)
function photoState(key, field, value) { (photoStates[key] ||= {})[field] = value }
function setClaimBusy(value) { claimBusy.value = value; emit('busy', value) }
function setClaimLocked(value) { claimLocked.value = value; emit('locked', value) }
watch(() => any('busy'), value => emit('photo-busy', value), { flush: 'sync', immediate: true })
watch(() => any('locked'), value => emit('photo-locked', value), { flush: 'sync', immediate: true })
watch(() => any('editing'), value => emit('editing', value), { flush: 'sync', immediate: true })
const qr = ref('')
const qrError = ref('')
let attempt = 0
async function makeQr() {
  const current = ++attempt
  qr.value = ''; qrError.value = ''
  if (photoBlocked.value || !props.activity.enabled || !props.me.allCompleted || !props.me.claimUrl || props.me.claimedAt) return
  try {
    const image = await QRCode.toDataURL(props.me.claimUrl, { errorCorrectionLevel: 'M', margin: 4, width: 280 })
    if (current === attempt) qr.value = image
  } catch { if (current === attempt) qrError.value = '领取二维码暂时无法显示，请重试。' }
}
watch(() => [props.me.claimUrl, props.me.claimedAt, props.activity.enabled, photoBlocked.value], makeQr, { immediate: true })
onUnmounted(() => { attempt++ })
</script>

<template>
  <section class="claim-panel" :class="{ 'claim-locked': !me.allCompleted }" aria-label="礼品领取">
    <p class="voucher-owner">游客编号：<strong>{{ me.userLabel }}</strong></p>
    <h3>{{ me.claimedAt ? '礼品已领取' : !activity.enabled ? '活动已结束' : me.allCompleted ? '漫游印记已集齐' : '还差一些漫游印记' }}</h3>
    <p class="voucher-progress">{{ me.completedCount }}/{{ me.totalCount }} · {{ me.allCompleted ? '已完成全部地点' : '尚未完成全部地点' }}</p>
    <p class="photo-inspection-note">请将下方各地点照片展示给现场工作人员当面核查。不合格时，请按现场指引重新拍摄或上传对应照片。</p>
    <ol class="voucher-photos" aria-label="各地点现场照片">
      <li v-for="point in points" :key="point.key" class="voucher-photo-card" :data-photo-point="point.key">
        <h4><span class="point-index">{{ point.displayOrder }}</span>{{ point.name }}</h4>
        <PhotoPanel gallery :point="point" :me="me" :enabled="activity.enabled" :max-bytes="Math.min(activity.rules.maxPhotoBytes, 15 * 1024 * 1024)" :disabled="photoBlocked || claimBusy || claimLocked"
          @busy="photoState(point.key, 'busy', $event)" @locked="photoState(point.key, 'locked', $event)" @editing="photoState(point.key, 'editing', $event)" @photo-state="emit('photo-state', $event)" @login-required="emit('login-required', $event)" />
      </li>
    </ol>
    <p v-if="photoBlocked" class="notice claim-photo-lock" role="status">照片修改或核对期间，暂不展示领取二维码，也不能在本页确认领取。取消修改或核对结束后恢复。</p>
    <template v-if="me.allCompleted && !me.claimedAt && activity.enabled && !photoBlocked">
      <p>{{ activity.claimLocationText }}</p>
      <p>向工作人员出示此码，或拿到礼品后自行确认。</p>
      <img v-if="qr" class="claim-qr" :src="qr" alt="礼品领取二维码" />
      <p v-if="qrError" role="alert">{{ qrError }} <button type="button" @click="makeQr">重试二维码</button></p>
      <p class="privacy-note">仅打开凭证不会标记领取。此码只向现场工作人员出示，不转发。</p>
    </template>
    <ClaimAction :state="me" :enabled="activity.enabled" :blocked="photoBlocked" label="我已领取礼品" confirm-label="确认已领取"
      confirmation="请在实际拿到礼品后确认。确认后将标记为已领取。"
      :submit="() => post('/api/me/claim', {})" :read-state="() => api('/api/me')"
      @state="emit('state', $event)" @busy="setClaimBusy" @locked="setClaimLocked" @login-required="emit('login-required', $event)" />
  </section>
</template>
