<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { api, post } from './api.js'
import { createScanner, loadWechatSdk } from './wechat-scan.js'
import PhotoPanel from './PhotoPanel.vue'
import ClaimPanel from './ClaimPanel.vue'
import VillageMap from './VillageMap.vue'
import PointArt from './PointArt.vue'
import ScanControls from './ScanControls.vue'
import IdentityStatus from './IdentityStatus.vue'

const activity = ref(null)
const error = ref('')
const me = ref(null)
const identityState = ref('loading')
const identityMessage = ref('')
const selectedKey = ref('')
const claimView = ref(false)
const photoUncertain = ref(false)
const claimUncertain = ref(false)
const scanNotice = ref('')
const scannedKey = ref('')
const uploadBusy = ref(false)
const claimBusy = ref(false)
const demoResult = ref('')
const demoBusy = ref(false)
const scannerState = reactive({ phase: 'idle', message: '' })
const inWechat = /MicroMessenger/i.test(navigator.userAgent)
const signatureUrl = window.location.href.split('#')[0]
const selectedPoint = computed(() => activity.value?.points.find((point) => point.key === selectedKey.value))
const operationLocked = computed(() => uploadBusy.value || claimBusy.value || photoUncertain.value || claimUncertain.value)
const identityProps = computed(() => ({ me: me.value, activity: activity.value, inWechat, identityState: identityState.value, identityMessage: identityMessage.value, locked: operationLocked.value }))
const scanProps = computed(() => ({ activity: activity.value, me: me.value, inWechat, state: scannerState, locked: operationLocked.value, demoBusy: demoBusy.value, demoResult: demoResult.value }))
const routeError = ref('')
// These are separate rendered views, not stacked home/detail panels with scroll-to navigation.
watch([selectedKey, claimView], async () => {
  await nextTick()
  const heading = selectedPoint.value ? document.querySelector('.point-heading h2') : document.getElementById(claimView.value ? 'claim-title' : 'map-title')
  window.scrollTo({ top: 0, behavior: 'auto' })
  heading?.focus({ preventScroll: true })
})
let identityBusy = false
let stateRevision = 0
function updateMe(state) {
  stateRevision++
  if (me.value && state.userLabel !== me.value.userLabel) { scannedKey.value = ''; scanNotice.value = '' }
  me.value = state
}
function setUploadBusy(value) {
  uploadBusy.value = value
  if (value) stateRevision++ // Discard an older in-flight progress response once an upload starts.
}

function setClaimBusy(value) {
  claimBusy.value = value
  if (value) stateRevision++
}

function loginFailure(cause) {
  if (cause.code === 'NEED_LOGIN') {
    me.value = null
    identityState.value = 'need-login'
    scannedKey.value = ''
    identityMessage.value = '身份已失效，请重新进入活动'
    stateRevision++
    scanNotice.value = ''
  }
}

function showScannedPoint(result) {
  if (operationLocked.value) return
  claimView.value = false
  scannedKey.value = result.point.key
  selectedKey.value = result.point.key
  scanNotice.value = result.alreadyCompleted ? '该地点已完成，本次扫码不会重复计数。' : '已识别当前扫码地点。'
  window.location.hash = `point/${result.point.key}`
}

const scanner = createScanner({
  state: scannerState,
  loadSdk: loadWechatSdk,
  getConfig: () => api(`/api/wechat/js-config?url=${encodeURIComponent(signatureUrl)}`),
  submit: (result) => post('/api/scan', { result }),
  onPoint: showScannedPoint,
  onFailure: loginFailure
})

function readRoute() {
  const match = /^#point\/([A-Za-z0-9_-]{1,32})$/.exec(window.location.hash)
  const key = match?.[1] || ''
  const wantsClaim = window.location.hash === '#claim'
  if (operationLocked.value && (key !== selectedKey.value || wantsClaim !== claimView.value)) {
    // Do not unmount an unknown-result panel via browser back/hash and thereby lose its lock.
    const hash = claimView.value ? '#claim' : selectedKey.value ? `#point/${selectedKey.value}` : ''
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
    return
  }
  if (key !== selectedKey.value) scanNotice.value = ''
  selectedKey.value = key
  claimView.value = wantsClaim
  routeError.value = window.location.hash && !match && !wantsClaim ? '页面入口无效，请从地图重新选择' : ''
}

function viewPoint(point) {
  if (operationLocked.value) return
  scanNotice.value = ''
  claimView.value = false
  selectedKey.value = point.key
  if (activity.value.developmentDemo) demoResult.value = `${activity.value.publicOrigin}/q/${point.key}`
  window.location.hash = `point/${point.key}`
}

function backHome() {
  if (operationLocked.value) return
  selectedKey.value = ''
  claimView.value = false
  scanNotice.value = ''
  window.location.hash = ''
}

function viewClaim() {
  if (operationLocked.value) return
  selectedKey.value = ''
  claimView.value = true
  scanNotice.value = ''
  window.location.hash = 'claim'
}

function startLogin() {
  try { sessionStorage.setItem('changqi.oauth-attempt', String(Date.now())) } catch { /* Manual login still works without storage. */ }
  window.location.assign(`/auth/wechat?returnTo=${encodeURIComponent(`/${window.location.hash}`)}`)
}

function tryAutomaticLogin() {
  if (!inWechat || activity.value.developmentDemo || !activity.value.wechatLoginAvailable || new URLSearchParams(window.location.search).has('authError')) return
  // This is only a redirect-loop guard, never a source of identity or progress.
  try {
    const previous = Number(sessionStorage.getItem('changqi.oauth-attempt') || 0)
    if (Date.now() - previous > 120000) {
      const attempt = String(Date.now())
      sessionStorage.setItem('changqi.oauth-attempt', attempt)
      if (sessionStorage.getItem('changqi.oauth-attempt') === attempt) startLogin()
    }
  } catch { /* Use the explicit login button when sessionStorage is unavailable. */ }
}

async function loadMe(automatic = false) {
  if (identityBusy || demoBusy.value || operationLocked.value) return
  identityBusy = true
  const revision = stateRevision
  if (!me.value) identityState.value = 'loading'
  identityMessage.value = ''
  try {
    const state = await api('/api/me')
    if (revision !== stateRevision || uploadBusy.value) return
    updateMe(state)
    identityState.value = 'ready'
    try { sessionStorage.removeItem('changqi.oauth-attempt') } catch { /* No stored identity. */ }
    if (inWechat && !activity.value.developmentDemo && scannerState.phase === 'idle') await scanner.initialize()
  } catch (cause) {
    if (revision !== stateRevision || uploadBusy.value) return
    me.value = null
    scannedKey.value = ''
    scanNotice.value = ''
    identityState.value = cause.code === 'NEED_LOGIN' ? 'need-login' : 'error'
    identityMessage.value = cause.message
    if (automatic && cause.code === 'NEED_LOGIN') tryAutomaticLogin()
  } finally { identityBusy = false }
}

async function loadActivity() {
  error.value = ''
  try {
    activity.value = await api('/api/activity')
    demoResult.value ||= `${activity.value.publicOrigin}/q/${activity.value.points[0].key}`
    readRoute()
    await loadMe(true)
  } catch (cause) { error.value = cause.message }
}

async function demoLogin(identity) {
  if (demoBusy.value || identityBusy || operationLocked.value) return
  scannedKey.value = ''
  demoBusy.value = true
  me.value = null
  identityState.value = 'loading'
  identityMessage.value = ''
  scanNotice.value = ''
  try {
    updateMe(await post('/api/dev/login', { identity }))
    identityState.value = 'ready'
  } catch (cause) {
    identityState.value = 'error'
    identityMessage.value = cause.message
  } finally { demoBusy.value = false }
}

async function demoScan() {
  if (demoBusy.value || operationLocked.value) return
  demoBusy.value = true
  scannerState.message = '正在识别开发演示二维码…'
  try {
    showScannedPoint(await post('/api/scan', { result: demoResult.value }))
    scannerState.message = '开发演示地点已识别；没有调用微信摄像头'
  } catch (cause) {
    loginFailure(cause)
    scannerState.message = cause.message
  } finally { demoBusy.value = false }
}

function restorePage() {
  if (document.visibilityState === 'hidden') return
  scanner.resume()
  if (activity.value && !demoBusy.value) void loadMe()
}

onMounted(() => {
  void loadActivity()
  window.addEventListener('hashchange', readRoute)
  window.addEventListener('pageshow', restorePage)
  document.addEventListener('visibilitychange', restorePage)
})
onUnmounted(() => {
  scanner.dispose()
  window.removeEventListener('hashchange', readRoute)
  window.removeEventListener('pageshow', restorePage)
  document.removeEventListener('visibilitychange', restorePage)
})
</script>

<template>
  <main class="page-shell" :class="{ 'detail-mode': selectedPoint, 'claim-mode': claimView }">
    <article v-if="activity" class="activity-card">
      <header v-if="!selectedPoint && !claimView" class="village-hero">
        <p class="brand-line"><span class="brand-seal" aria-hidden="true">岐</span>{{ activity.wechat.officialAccountName }}<span class="brand-note">乡村漫游手记</span></p>
        <div class="hero-copy"><p class="eyebrow">走进古村 · 留下你的风景</p><h1>{{ activity.activityName }}</h1><p class="intro">上传现场照片，收集你的漫游印记。</p></div>
      </header>
      <div class="page-content">
        <nav v-if="selectedPoint || claimView" class="detail-nav" aria-label="返回活动地图"><button type="button" class="back-button" :disabled="operationLocked" @click="backHome"><span aria-hidden="true">←</span> 返回地图</button><span>长岐漫游手记</span></nav>
        <p v-if="activity.developmentDemo" class="notice demo-label"><strong>开发演示</strong> · 模拟身份与扫码，非微信真机</p>
        <p v-else-if="!inWechat" class="notice browser-notice">请在微信内打开活动。当前仅可查看地点。</p>
        <p v-if="!activity.enabled" class="notice" role="status">活动暂未开放或已结束。已有进度仍可查看。</p>

        <section v-if="selectedPoint" class="point-detail" aria-live="polite" :data-point-key="selectedPoint.key">
          <div class="point-heading"><span class="point-index">{{ selectedPoint.displayOrder }}</span><div><p class="eyebrow">这一站的风景</p><h2 tabindex="-1">{{ selectedPoint.name }}</h2></div><span class="paper-tag">{{ me?.completedKeys.includes(selectedPoint.key) ? '已完成' : '照片打卡' }}</span></div>
          <PointArt :key="selectedPoint.key" :point="selectedPoint" eager />
          <p class="art-caption">主题概念插画 · 非现场实景</p>
          <IdentityStatus v-bind="identityProps" compact @refresh="loadMe()" @login="startLogin" />
          <p class="scan-notice muted">{{ scanNotice || '仅查看地点，尚未取得扫码资格。' }}</p>
          <PhotoPanel v-if="me" :key="`${me.userLabel}:${selectedPoint.key}`" :point="selectedPoint" :me="me"
            :enabled="activity.enabled" :scanned="scannedKey === selectedPoint.key" :max-bytes="Math.min(activity.rules.maxPhotoBytes, 15 * 1024 * 1024)"
            @state="updateMe" @busy="setUploadBusy" @locked="photoUncertain = $event" @login-required="loginFailure" @scan-required="scannedKey = ''" @continue="backHome" @claim="viewClaim">
            <template #scan><ScanControls v-bind="scanProps" @scan="scanner.scan" @prepare="scanner.initialize" @demo-scan="demoScan" @update:demo-result="demoResult = $event" /></template>
          </PhotoPanel>
          <ScanControls v-else v-bind="scanProps" @scan="scanner.scan" @prepare="scanner.initialize" @demo-scan="demoScan" @update:demo-result="demoResult = $event" />
          <details v-if="me && (scannedKey === selectedPoint.key || me.completedKeys.includes(selectedPoint.key))" class="scan-help">
            <summary>需要重新扫一扫？</summary><ScanControls v-bind="scanProps" secondary @scan="scanner.scan" @prepare="scanner.initialize" @demo-scan="demoScan" @update:demo-result="demoResult = $event" />
          </details>
        </section>

        <section v-else-if="claimView" class="own-claim-view" aria-labelledby="claim-title">
          <header class="claim-heading"><p class="eyebrow">你的长岐漫游记录</p><h2 id="claim-title" tabindex="-1">领取凭证</h2></header>
          <IdentityStatus v-bind="identityProps" compact @refresh="loadMe()" @login="startLogin" />
          <ClaimPanel v-if="me" :key="me.userLabel" :me="me" :activity="activity" @state="updateMe" @busy="setClaimBusy" @locked="claimUncertain = $event" @login-required="loginFailure" />
          <button v-if="me" type="button" class="text-button" :disabled="operationLocked" @click="loadMe()">刷新状态</button>
        </section>

        <template v-else>
          <IdentityStatus v-bind="identityProps" @refresh="loadMe()" @login="startLogin" />
          <p v-if="selectedKey || routeError" role="alert">{{ routeError || '地点不存在，请从地图重新选择' }}</p>
          <ScanControls v-if="!me?.claimedAt" v-bind="scanProps" :secondary="me?.allCompleted" @scan="scanner.scan" @prepare="scanner.initialize" @demo-scan="demoScan" @update:demo-result="demoResult = $event" />
          <p v-if="!me?.allCompleted && activity.enabled" class="claim-hint">集齐 {{ activity.points.length }} 处照片印记后，可前往现场领取礼品。</p>
          <VillageMap :points="activity.points" :completed-keys="me?.completedKeys || []" :logged-in="Boolean(me)" :disabled="operationLocked" @view="viewPoint" />
          <section v-if="me?.allCompleted" class="reward-next" aria-live="polite">
            <template v-if="me.claimedAt"><p class="claimed-status">已领取礼品 · 谢谢参与这次漫游</p><button type="button" class="secondary" @click="viewClaim">查看领取记录</button></template>
            <template v-else-if="activity.enabled"><p>漫游印记已集齐，去领取你的纪念礼品吧。</p><button type="button" class="claim-link" @click="viewClaim">查看领取凭证</button></template>
            <p v-else>活动已结束，已有漫游记录仍可查看。</p>
          </section>
          <details class="point-disclosure">
            <summary>查看全部地点（{{ activity.points.length }}处）</summary>
            <ul class="point-list">
              <li v-for="point in activity.points" :key="point.key">
                <button type="button" class="point-button" :data-point-key="point.key" :disabled="operationLocked" @click="viewPoint(point)">
                  <PointArt :point="point" variant="thumbnail" /><span class="point-index">{{ point.displayOrder }}</span><span class="list-point-name">{{ point.name }}</span>
                  <small v-if="me" class="point-status" :class="{ done: me.completedKeys.includes(point.key) }">{{ me.completedKeys.includes(point.key) ? '已完成' : '未完成' }}</small><span v-else class="point-arrow" aria-hidden="true">↗</span>
                </button>
              </li>
            </ul>
          </details>
          <details class="rules-card"><summary>活动规则</summary><p>从“{{ activity.wechat.officialAccountName }}”公众号菜单进入活动，在现场使用页面内扫一扫识别地点码，再上传现场照片。所有地点完成后，可前往现场领取礼品。</p><p>不限打卡顺序。照片仅用于本次活动记录，不公开展示；领取处以现场指引为准。</p></details>
        </template>

        <details v-if="activity.developmentDemo" class="demo-tools"><summary>开发演示身份切换</summary><div class="demo-controls"><button type="button" :disabled="demoBusy || operationLocked" @click="demoLogin('visitor-a')">演示游客 A</button><button type="button" :disabled="demoBusy || operationLocked" @click="demoLogin('visitor-b')">演示游客 B</button></div></details>
        <footer class="page-footer">一程慢游，一份长岐记忆<span>插画与路线为游览示意，非实景测绘</span></footer>
      </div>
    </article>
    <section v-else-if="error" class="activity-card error-card" role="alert"><h1>暂时无法打开活动</h1><p>{{ error }}</p><button type="button" @click="loadActivity">重新加载</button></section>
    <section v-else class="loading paper-card" role="status"><span class="brand-seal" aria-hidden="true">岐</span><h1>长岐漫游手记</h1><p>正在打开活动…</p></section>
  </main>
</template>
