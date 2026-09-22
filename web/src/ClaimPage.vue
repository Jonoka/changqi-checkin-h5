<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { api, post } from './api.js'
import ClaimAction from './ClaimAction.vue'

const code = /^\/r\/([a-f0-9]{32})\/?$/.exec(window.location.pathname)?.[1]
const state = ref(null)
const activity = ref(null)
const error = ref('')
const loading = ref(false)
const busy = ref(false)
let revision = 0
let alive = true
const endpoint = `/api/r/${code || 'invalid'}`
function adopt(value) { revision++; state.value = value }
function setBusy(value) { busy.value = value; if (value) revision++ }
async function refresh() {
  if (busy.value || loading.value) return
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
onMounted(() => { void refresh(); window.addEventListener('pageshow', restore); document.addEventListener('visibilitychange', restore) })
onUnmounted(() => { alive = false; window.removeEventListener('pageshow', restore); document.removeEventListener('visibilitychange', restore) })
</script>

<template>
  <main class="page-shell">
    <section class="activity-card staff-claim">
      <p class="brand-line"><span class="brand-seal" aria-hidden="true">岐</span>长岐漫游手记<span class="brand-note">现场礼品领取</span></p>
      <h1>礼品派发确认</h1>
      <img class="staff-illustration" src="/art/lane.webp" alt="" aria-hidden="true" width="640" height="265" />
      <p v-if="activity?.developmentDemo" class="notice">开发演示 · 非真实现场派发</p>
      <p>仅查看或扫描本页不会标记领取。请在实际交付礼品后确认，不要重复派发。</p>
      <p v-if="loading" role="status">正在读取领取凭证…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="state && activity">
        <p>{{ state.userLabel }}</p>
        <p class="claim-progress">{{ state.completedCount }}/{{ state.totalCount }} · {{ state.allCompleted ? '已完成全部地点' : '尚未完成全部地点' }}</p>
        <ClaimAction :state="state" :enabled="activity.enabled" label="已完成奖品派发" confirm-label="确认已派发"
          confirmation="请确认已将礼品交给这位游客。确认后将标记为已领取。"
          :submit="() => post(`${endpoint}/claim`, {})" :read-state="() => api(endpoint)"
          @state="adopt" @busy="setBusy" />
      </template>
      <button type="button" class="secondary" :disabled="busy || loading" @click="refresh">刷新领取状态</button>
      <footer class="page-footer">仅确认一次，保留首次领取记录<span>此页不展示游客照片，无需员工账号</span></footer>
    </section>
  </main>
</template>
