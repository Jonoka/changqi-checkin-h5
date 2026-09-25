let sdkLoading = null

export const WECHAT_SHARE_DATA = Object.freeze({
  title: '2026三水区芦苞镇长岐古村黄金节庆影视游园季活动',
  desc: '微信扫码参与长岐村漫游打卡，上传现场照片，集齐地点后现场领取礼品。',
  imgUrl: 'https://cq.fsxinhuo.cn/share/share-card-v1.jpg',
  link: 'https://cq.fsxinhuo.cn/'
})

export function setWechatShareData(sdk, shareData = WECHAT_SHARE_DATA) {
  const appMessageData = { ...shareData }
  const timelineData = { title: shareData.title, link: shareData.link, imgUrl: shareData.imgUrl }
  if (typeof sdk.updateAppMessageShareData === 'function') sdk.updateAppMessageShareData(appMessageData)
  else sdk.onMenuShareAppMessage?.(appMessageData)
  if (typeof sdk.updateTimelineShareData === 'function') sdk.updateTimelineShareData(timelineData)
  else sdk.onMenuShareTimeline?.(timelineData)
}

export function loadWechatSdk() {
  if (window.wx) return Promise.resolve(window.wx)
  if (sdkLoading) return sdkLoading
  sdkLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    let finished = false
    const finish = (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      script.onload = script.onerror = null
      if (error) { script.remove(); reject(error) } else { resolve(window.wx) }
    }
    const timer = setTimeout(() => finish(new Error('微信 SDK 加载超时，请重试')), 10000)
    script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js'
    script.async = true
    script.onload = () => finish(window.wx ? null : new Error('微信 SDK 未加载，请重试'))
    script.onerror = () => finish(new Error('微信 SDK 加载失败，请重试'))
    document.head.appendChild(script)
  }).finally(() => { sdkLoading = null })
  return sdkLoading
}

export async function initializeWechatShare({ getConfig, loadSdk = loadWechatSdk, timeout = 12000 } = {}) {
  if (!/MicroMessenger/i.test(navigator.userAgent)) return false
  let timer
  try {
    const sdk = await Promise.race([
      (async () => {
        const loaded = await loadSdk()
        const config = await getConfig()
        await new Promise((resolve, reject) => {
          loaded.error(() => reject(new Error('微信分享初始化失败')))
          loaded.config({ debug: false, ...config })
          loaded.ready(resolve)
        })
        setWechatShareData(loaded)
        return loaded
      })(),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('微信分享初始化超时')), timeout) })
    ])
    return Boolean(sdk)
  } finally { clearTimeout(timer) }
}

// Shared by the real Vue page and lightweight tests. Tests inject a clearly simulated SDK.
export function createScanner({ state, loadSdk, getConfig, submit, onPoint, onFailure = () => {}, shareData = WECHAT_SHARE_DATA, initTimeout = 12000, scanTimeout = 90000, resumeDelay = 500 }) {
  let sdk = null
  let generation = 0
  let scanVersion = 0
  let cancelScan = null
  let resumeTimer = null
  let disposed = false

  async function initialize() {
    if (disposed || state.phase === 'initializing') return false
    cancelScan?.('扫码已中止，请重试')
    const version = ++generation
    state.phase = 'initializing'
    state.message = '正在准备微信扫一扫…'
    let timer
    try {
      await Promise.race([
        (async () => {
          sdk = await loadSdk()
          const config = await getConfig()
          if (version !== generation || disposed) return
          await new Promise((resolve, reject) => {
            sdk.error(() => {
              if (version !== generation || disposed) return
              if (state.phase === 'initializing') reject(new Error('微信扫一扫初始化失败，请重试'))
              else {
                cancelScan?.('微信扫一扫已失效，请重新初始化')
                state.phase = 'error'
                state.message = '微信扫一扫已失效，请重新初始化'
              }
            })
            sdk.config({ debug: false, ...config })
            sdk.ready(() => { setWechatShareData(sdk, shareData); resolve() })
          })
        })(),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('微信扫一扫准备超时，请重试')), initTimeout) })
      ])
      if (version !== generation || disposed) return false
      state.phase = 'ready'
      state.message = '' // Readiness enables the button without an extra status line.
      return true
    } catch (error) {
      if (version !== generation || disposed) return false
      generation++ // Discard late SDK callbacks from this failed attempt.
      state.phase = 'error'
      state.message = error.message || '微信扫一扫初始化失败，请重试'
      // Configuration/SDK failures affect scanning only. Native upload uses its own authenticated API.
      // Do not clear an already identified visitor (including on a failed JS-config request).
      return false
    } finally { clearTimeout(timer) }
  }

  function scan() {
    if (disposed) return Promise.resolve(false)
    if (state.phase !== 'ready') {
      state.message = '扫一扫尚未就绪，请先完成初始化或重试'
      return Promise.resolve(false)
    }
    const version = ++scanVersion
    state.phase = 'scanning'
    state.message = '请扫描现场活动地点二维码'
    return new Promise((resolve) => {
      let timer
      const active = () => !disposed && scanVersion === version
      const finish = (message, success = false) => {
        if (!active()) return
        scanVersion++
        clearTimeout(timer)
        clearTimeout(resumeTimer)
        cancelScan = null
        state.phase = 'ready'
        state.message = message
        resolve(success)
      }
      cancelScan = finish
      timer = setTimeout(() => finish('未收到扫码结果，请再次扫一扫'), scanTimeout)
      try {
        // Must run synchronously from the user's click, with needResult: 1. Never navigate to resultStr.
        sdk.scanQRCode({
          needResult: 1,
          scanType: ['qrCode'],
          success: async (result) => {
            if (!active() || state.phase !== 'scanning') return
            clearTimeout(timer)
            clearTimeout(resumeTimer)
            state.phase = 'submitting'
            state.message = '正在识别地点…'
            try {
              const point = await submit(result?.resultStr)
              if (!active()) return
              onPoint(point)
              finish('地点已识别；扫码本身不会增加打卡进度', true)
            } catch (error) {
              if (!active()) return
              onFailure(error)
              finish(error.message || '地点识别失败，请重试')
            }
          },
          cancel: () => finish('已取消扫码，可以再次扫一扫'),
          fail: () => finish('未能使用扫一扫，请检查微信相机权限后重试')
        })
      } catch { finish('未能打开微信扫一扫，请重试或重新初始化') }
    })
  }

  function resume() {
    // Some WebViews resume without cancel/fail. Give a pending native success callback time to arrive.
    if (state.phase === 'scanning') {
      const version = scanVersion
      clearTimeout(resumeTimer)
      resumeTimer = setTimeout(() => {
        if (version === scanVersion && state.phase === 'scanning') cancelScan?.('已返回活动，可以再次扫一扫')
      }, resumeDelay)
    }
  }

  function dispose() {
    cancelScan?.('扫码已中止')
    disposed = true
    generation++
    clearTimeout(resumeTimer)
  }
  return { initialize, scan, resume, dispose }
}
