<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { api, post } from './api.js'
import { createScanner, loadWechatSdk } from './wechat-scan.js'
import PhotoPanel from './PhotoPanel.vue'
import ClaimPanel from './ClaimPanel.vue'
import VillageMap from './VillageMap.vue'

const activity = ref(null)
const error = ref('')
const me = ref(null)
const identityState = ref('loading')
const identityMessage = ref('')
const selectedKey = ref('')
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
const routeError = ref('')
// Route changes reveal and focus their actual heading; returning from the photo picker does not move it.
watch(selectedKey, async (key) => {
  await nextTick()
  const heading = key ? document.querySelector('.point-heading h2') : document.getElementById('map-title')
  heading?.focus({ preventScroll: true })
  heading?.scrollIntoView({ block: 'start', behavior: 'auto' })
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
  if (uploadBusy.value) return
  scannedKey.value = result.point.key
  selectedKey.value = result.point.key
  scanNotice.value = result.alreadyCompleted ? '此地点已有完成记录；本次扫码未改变进度。' : '已识别当前扫码地点；扫码本身不会增加进度。'
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
  if (key !== selectedKey.value) scanNotice.value = ''
  selectedKey.value = key
  routeError.value = window.location.hash && !match ? '页面入口无效，请从地点列表重新选择' : ''
}

function viewPoint(point) {
  if (uploadBusy.value) return
  scanNotice.value = ''
  selectedKey.value = point.key
  window.location.hash = `point/${point.key}`
}

function backHome() {
  if (uploadBusy.value) return
  selectedKey.value = ''
  scanNotice.value = ''
  window.location.hash = ''
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
  if (identityBusy || demoBusy.value || uploadBusy.value || claimBusy.value) return
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
    demoResult.value ||= `${activity.value.publicOrigin}/q/p01`
    readRoute()
    await loadMe(true)
  } catch (cause) { error.value = cause.message }
}

async function demoLogin(identity) {
  if (demoBusy.value || identityBusy || uploadBusy.value || claimBusy.value) return
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
  if (demoBusy.value || uploadBusy.value || claimBusy.value) return
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
  <main class="page-shell" :class="{ 'detail-mode': selectedPoint }">
    <article v-if="activity" class="activity-card">
      <header class="village-hero" :class="{ compact: selectedPoint }">
        <p class="brand-line"><span class="brand-seal" aria-hidden="true">岐</span>{{ activity.wechat.officialAccountName }}<span class="brand-note">乡村漫游手记</span></p>
        <div class="hero-copy"><p class="eyebrow">走进古村 · 留下你的风景</p><h1>{{ activity.activityName }}</h1><p class="intro">上传现场照片，记录你的长岐村漫游。</p></div>
        <img v-if="!selectedPoint" class="hero-art" src="/art/village.webp" width="650" height="310" alt="" aria-hidden="true" fetchpriority="high" />
        <p v-if="!selectedPoint" class="hero-ribbon">扫码识别地点<span>·</span>拍下现场风景<span>·</span>收集漫游印记</p>
      </header>
      <div class="page-content">
      <p v-if="activity.developmentDemo" class="notice demo-label"><strong>开发演示</strong> · 模拟身份与二维码输入，使用真实测试数据库和会话；不是微信真机结果。</p>
      <p v-else-if="!inWechat" class="notice">请在微信内打开活动。本浏览器可查看地点，但不能使用微信授权和扫一扫。</p>
      <p v-if="!activity.enabled" class="notice" role="status">活动暂未开放或已结束。已有进度仍可查看。</p>

      <section class="identity-block paper-card" aria-live="polite" aria-label="本人漫游进度"><p class="eyebrow">漫游进度</p>
        <p v-if="identityState === 'loading'">正在恢复本人身份…</p>
        <template v-if="me">
          <div class="progress-heading"><div><p class="user-label">{{ me.userLabel }} · 本人漫游进度</p><p class="progress-copy">{{ me.allCompleted ? '漫游印记已集齐' : '每一站，都值得留下' }}</p></div><div class="point-count">{{ me.completedCount }}/{{ me.totalCount }}</div></div>
          <progress class="progress-track" :value="me.completedCount" :max="me.totalCount" :aria-label="`已完成 ${me.completedCount}，共 ${me.totalCount} 个地点`"></progress>
          <div class="progress-footer"><span>保存照片后，才计入完成进度</span><button type="button" class="text-button" :disabled="uploadBusy || claimBusy" @click="loadMe()">刷新本人状态</button></div>
        </template>
        <template v-else>
          <p>登录后显示本人进度 · 共 {{ activity.points.length }} 个地点</p>
          <p v-if="identityMessage" role="status">{{ identityMessage }}</p>
          <button v-if="inWechat && !activity.developmentDemo && activity.wechatLoginAvailable" type="button" @click="startLogin">重新识别微信身份</button>
          <p v-if="inWechat && !activity.developmentDemo && !activity.wechatLoginAvailable">微信接入尚未配置完成，请稍后从公众号菜单重试。</p>
          <button type="button" class="secondary" @click="loadMe()">重试读取身份</button>
        </template>
      </section>

      <ClaimPanel v-if="me" :key="me.userLabel" :me="me" :activity="activity"
        @state="updateMe" @busy="setClaimBusy" @login-required="loginFailure" />

      <div v-if="activity.developmentDemo" class="demo-controls">
        <button type="button" :disabled="demoBusy || uploadBusy || claimBusy" @click="demoLogin('visitor-a')">演示游客 A</button>
        <button type="button" :disabled="demoBusy || uploadBusy || claimBusy" @click="demoLogin('visitor-b')">演示游客 B</button>
        <label for="demo-qr">开发演示：输入完整地点二维码 URL</label>
        <input id="demo-qr" v-model="demoResult" type="text" autocomplete="off" />
        <button type="button" :disabled="!me || !activity.enabled || demoBusy || uploadBusy || claimBusy" @click="demoScan">识别演示地点码</button>
      </div>
      <div v-else class="scan-controls scan-dock">
        <button type="button" :disabled="!me || !inWechat || !activity.enabled || uploadBusy || claimBusy || scannerState.phase !== 'ready'" @click="scanner.scan">扫一扫打卡</button>
        <button v-if="me && inWechat && ['error', 'idle'].includes(scannerState.phase)" type="button" class="secondary" @click="scanner.initialize">重新准备扫一扫</button>
      </div>
      <p v-if="scannerState.message" class="notice" role="status">{{ scannerState.message }}</p>

      <section v-if="selectedPoint" class="point-detail paper-card" aria-live="polite">
        <div class="point-heading"><span class="point-index">{{ selectedPoint.displayOrder }}</span><div><p class="eyebrow">这一站的风景</p><h2 tabindex="-1">{{ selectedPoint.name }}</h2></div><span class="paper-tag">{{ me?.completedKeys.includes(selectedPoint.key) ? '已完成' : '照片打卡' }}</span></div>
        <img class="point-art" src="/art/lane.webp" alt="" aria-hidden="true" width="640" height="265" />
        <p>{{ !me ? '登录后查看本人的完成状态' : me.completedKeys.includes(selectedPoint.key) ? '本人已有该地点的完成记录' : '该地点尚未完成' }}</p>
        <p>{{ scanNotice || '仅查看地点；点击地图或列表不会取得扫码资格。' }}</p>
        <PhotoPanel v-if="me" :key="`${me.userLabel}:${selectedPoint.key}`" :point="selectedPoint" :me="me"
          :enabled="activity.enabled" :scanned="scannedKey === selectedPoint.key" :max-bytes="Math.min(activity.rules.maxPhotoBytes, 15 * 1024 * 1024)"
          @state="updateMe" @busy="setUploadBusy" @login-required="loginFailure" @scan-required="scannedKey = ''" />
        <p v-else>请先恢复本人身份，再扫码上传现场照片。</p>
        <button type="button" class="secondary" :disabled="uploadBusy" @click="backHome">返回地点列表</button>
      </section>
      <template v-else>
        <p v-if="selectedKey || routeError" role="alert">{{ routeError || '地点不存在，请从列表重新选择' }}</p>
        <VillageMap :points="activity.points" :completed-keys="me?.completedKeys || []" :logged-in="Boolean(me)" :disabled="uploadBusy || claimBusy" @view="viewPoint" />
        <div class="section-heading"><h2>长岐漫游地点</h2><span class="muted">共 {{ activity.points.length }} 处</span></div>
        <p class="muted">点击只查看地点；请使用页面内扫一扫识别现场地点码。</p>
        <ul class="point-list">
          <li v-for="point in activity.points" :key="point.key">
            <button type="button" class="point-button" @click="viewPoint(point)">
              <span class="point-index">{{ point.displayOrder }}</span>
              <span>{{ point.name }}</span>
              <small v-if="me" class="point-status" :class="{ done: me.completedKeys.includes(point.key) }">{{ me.completedKeys.includes(point.key) ? '已完成' : '未完成' }}</small><span v-else class="point-arrow" aria-hidden="true">↗</span>
            </button>
          </li>
        </ul>
      </template>
      <details class="rules-card"><summary>怎样收集漫游印记？</summary><p>从公众号菜单进入活动，在现场使用页面内扫一扫识别地点码，再上传一张现场照片。所有地点完成后，前往现场领取礼品。</p><p>照片仅用于本次活动记录，不公开展示；领取处以现场指引为准。</p></details>
      <footer class="page-footer">一程慢游，一份长岐记忆<span>插画与路线为游览示意，非实景测绘</span></footer>
      </div>
    </article>
    <section v-else-if="error" class="activity-card error-card" role="alert">
      <h1>暂时无法打开活动</h1>
      <p>{{ error }}</p>
      <button type="button" @click="loadActivity">重新加载</button>
    </section>
    <section v-else class="loading paper-card" role="status"><span class="brand-seal" aria-hidden="true">岐</span><h1>长岐漫游手记</h1><p>正在打开活动…</p></section>
  </main>
</template>
