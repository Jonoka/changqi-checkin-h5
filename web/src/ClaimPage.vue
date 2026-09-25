<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { api, post } from './api.js'
import ClaimAction from './ClaimAction.vue'
import { initializeWechatShare } from './wechat-scan.js'

const code = /^\/r\/([a-f0-9]{32})\/?$/.exec(window.location.pathname)?.[1]
const state = ref(null)
const activity = ref(null)
const error = ref('')
const loading = ref(false)
const busy = ref(false)
const uncertain = ref(false)
let revision = 0
let alive = true
const endpoint = `/api/r/${code || 'invalid'}`
function adopt(value) { revision++; state.value = value }
function setBusy(value) { busy.value = value; if (value) revision++ }
async function refresh() {
  if (busy.value || uncertain.value || loading.value) return
  if (!code) { error.value = '领取凭证不存在，请核对游客出示的二维码'; return }
  loading.value = true; error.value = ''
  const current = revision
  try {
    const [nextState, nextActivity] = await Promise.all([api(endpoint), api('/api/activity')])
    if (!alive || current !== revision) return
    adopt(nextState); activity.value = nextActivity
  } catch (cause) { if (alive && current === revision) { error.value = cause.message; state.value = null } }
  finally { loading.value = false }
}
function restore() { if (document.visibilityState !== 'hidden') void refresh() }
onMounted(() => {
  void refresh()
  void initializeWechatShare({ getConfig: () => api(`/api/wechat/js-config?url=${encodeURIComponent(window.location.href.split('#')[0])}`) }).catch(() => {})
  window.addEventListener('pageshow', restore)
  document.addEventListener('visibilitychange', restore)
})
onUnmounted(() => { alive = false; window.removeEventListener('pageshow', restore); document.removeEventListener('visibilitychange', restore) })
</script>

<template>
  <main class="page-shell">
    <section class="activity-card staff-claim">
      <p class="brand-line"><span class="brand-seal" aria-hidden="true">岐</span>长岐漫游手记<span class="brand-note">现场礼品领取</span></p>
      <h1>礼品派发确认</h1>
      <p v-if="activity?.developmentDemo" class="notice">开发演示 · 非真实现场派发</p>
      <p class="staff-purpose">工作人员使用 · 交付礼品后再确认。打开此页不会标记领取。</p>
      <p v-if="loading" role="status">正在读取领取凭证…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="state && activity">
        <div class="staff-summary"><p class="eyebrow">游客编号</p><p class="guest-number">{{ state.userLabel }}</p><dl><div><dt>完成状态</dt><dd class="claim-progress">{{ state.completedCount }}/{{ state.totalCount }} · {{ state.allCompleted ? '已完成全部地点' : '尚未完成全部地点' }}</dd></div><div><dt>领取状态</dt><dd>{{ state.claimedAt ? '已领取，请勿重复派发' : '尚未领取' }}</dd></div></dl></div>
        <ClaimAction :state="state" :enabled="activity.enabled" label="已完成奖品派发" confirm-label="确认已派发"
          confirmation="请确认已将礼品交给这位游客。确认后将标记为已领取。"
          :submit="() => post(`${endpoint}/claim`, {})" :read-state="() => api(endpoint)"
          @state="adopt" @busy="setBusy" @locked="uncertain = $event" />
      </template>
      <button type="button" class="secondary" :disabled="busy || uncertain || loading" @click="refresh">刷新领取状态</button>
      <footer class="page-footer">仅确认一次，保留首次领取记录<span>此页不展示游客照片，无需员工账号</span></footer>
    </section>
  </main>
</template>
