import { randomBytes, timingSafeEqual } from 'node:crypto'
import { HttpError, sendPage } from './http.js'
import { cookieName, discardSession, regenerateSession, saveSession } from './session.js'
import { findOrCreateUser, requireUserSession, userProgress, currentPointKey, setCurrentPoint } from './identity.js'
import { parsePointQr, safeReturnTo } from './wechat.js'

export function mountGuide(app, activity, runtime) {
  // Only guest point entry is split by environment. Public claims, stats and APIs are not UA-authenticated.
  app.get('/q/:pointKey', (request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    response.vary('User-Agent')
    const point = activity.points.find((item) => item.key === request.params.pointKey)
    if (!point) return sendPage(response, { status: 404, title: '地点不存在', code: 'INVALID_POINT', message: '地点不存在，请扫描现场活动二维码', demo: runtime.mockEnabled })
    if (/MicroMessenger/i.test(request.get('user-agent') || '')) {
      request.entryPointKey = point.key // Validated before loading any session or starting OAuth.
      return next()
    }
    return sendPage(response, {
      title: '参与方式', demo: runtime.mockEnabled, guide: true,
      message: `请在微信内打开活动。\n${activity.wechat.guideText}`,
      officialAccountName: activity.wechat.officialAccountName,
      officialAccountQr: activity.wechat.officialAccountQr,
      activityName: activity.activityName
    })
  })
}

function retryPath(request, activity) {
  // A suffix on the existing random OAuth state is only a public, validated manual-retry hint.
  // It cannot authenticate or grant a point. This still works when the browser rejected every cookie.
  const encodedHint = typeof request.query.state === 'string' && /^[a-f0-9]{48}P((?:[a-f0-9]{2}){1,32})$/.exec(request.query.state)?.[1]
  const hint = encodedHint ? Buffer.from(encodedHint, 'hex').toString('utf8') : null
  const key = request.entryPointKey || request.session?.oauth?.entryPointKey || hint
  return activity.points.some(point => point.key === key) ? `/q/${key}` : '/auth/wechat'
}

export async function sendIdentityFailure(request, response, error, activity, runtime) {
  const retryTo = request.authRetryTo || retryPath(request, activity)
  await discardSession(request)
  response.clearCookie(cookieName, { path: '/', httpOnly: true, sameSite: 'lax', secure: runtime.secureCookie })
  const failure = error instanceof HttpError ? error : new HttpError(500, 'LOGIN_FAILED', '暂时无法识别微信身份，请稍后重试')
  if (!(error instanceof HttpError)) console.error('Identity request failed')
  return sendPage(response, { status: failure.status, title: '身份识别未完成', message: failure.message, code: failure.code, retry: true, retryTo, demo: runtime.mockEnabled })
}

export function mountIdentityAndScan(app, { pool, runtime, wechatClient, sessionsAvailable, activityConfig }) {
  const unavailable = () => { throw new HttpError(503, 'AUTH_UNAVAILABLE', '微信身份服务尚未配置完成，暂可浏览活动；请稍后重试') }
  const authHandler = (handler) => async (request, response) => {
    response.set('Cache-Control', 'no-store')
    request.authRetryTo = retryPath(request, activityConfig)
    try { await handler(request, response) } catch (error) {
      await sendIdentityFailure(request, response, error, activityConfig, runtime)
    }
  }
  async function login(request, user, developmentIdentity = false, entryPointKey = null) {
    await regenerateSession(request)
    request.session.userId = String(user.id)
    request.session.developmentIdentity = developmentIdentity
    setCurrentPoint(request.session, activityConfig, entryPointKey)
    await saveSession(request)
  }
  const requireUser = requireUserSession(pool, runtime)
  function requireSameOriginJson(request) {
    const origin = request.get('origin')
    if (origin && origin !== runtime.publicOrigin) throw new HttpError(403, 'INVALID_ORIGIN', '请从本活动页面操作')
    if (!request.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', '请通过活动页面提交扫码结果')
  }

  async function beginAuthorization(request, response, entryPointKey = null) {
    if (!pool || !sessionsAvailable || !wechatClient) unavailable()
    const returnTo = entryPointKey ? `/#point/${entryPointKey}` : safeReturnTo(request.query.returnTo, runtime.publicOrigin)
    // Always replace any previous identity at a direct /q entry; don't trust a shared/stale cookie.
    await regenerateSession(request)
    const state = randomBytes(24).toString('hex') + (entryPointKey ? `P${Buffer.from(entryPointKey).toString('hex')}` : '')
    request.session.oauth = { state, entryPointKey, returnTo, createdAt: Date.now() }
    await saveSession(request)
    response.redirect(302, wechatClient.authorizationUrl(state))
  }
  app.get('/auth/wechat', authHandler((request, response) => beginAuthorization(request, response)))
  app.get('/q/:pointKey', authHandler((request, response) => {
    if (!request.entryPointKey) throw new HttpError(404, 'INVALID_POINT', '地点不存在，请扫描现场活动二维码')
    return beginAuthorization(request, response, request.entryPointKey)
  }))

  app.get('/auth/callback', authHandler(async (request, response) => {
    if (!pool || !sessionsAvailable || !wechatClient) unavailable()
    const pending = request.session?.oauth
    const state = request.query.state
    if (!pending || typeof pending.state !== 'string' || typeof state !== 'string' || !/^[a-f0-9]{48}(?:P(?:[a-f0-9]{2}){1,32})?$/.test(state) || state.length !== pending.state.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state)) || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      throw new HttpError(400, 'OAUTH_STATE_INVALID', '授权信息已失效或不匹配，请重新授权')
    }
    // Capture validated server context before consume/save/regenerate can remove the old session.
    const entryPointKey = pending.entryPointKey || null
    if (entryPointKey && !activityConfig.points.some(point => point.key === entryPointKey)) throw new HttpError(404, 'INVALID_POINT', '地点已不可用，请扫描有效地点码')
    const returnTo = entryPointKey ? `/#point/${entryPointKey}` : safeReturnTo(pending.returnTo, runtime.publicOrigin)
    delete request.session.oauth
    await saveSession(request)
    const code = request.query.code
    if (typeof code !== 'string' || !code || code.length > 512) throw new HttpError(400, 'AUTH_CANCELLED', '授权未完成或已取消，请重新授权')
    const openid = await wechatClient.exchangeCode(code)
    const user = await findOrCreateUser(pool, openid)
    await login(request, user, false, entryPointKey)
    response.redirect(302, returnTo)
  }))

  app.get('/api/me', requireUser, async (request, response) => {
    response.json({ ok: true, data: {
      ...await userProgress(pool, request.currentUser, activityConfig, runtime.publicOrigin),
      scannedPointKey: currentPointKey(request.session, activityConfig)
    } })
  })

  app.get('/api/wechat/js-config', requireUser, async (request, response) => {
    if (!wechatClient) unavailable()
    const config = await wechatClient.jsConfig(request.query.url)
    response.json({ ok: true, data: config })
  })

  app.post('/api/scan', requireUser, async (request, response) => {
    requireSameOriginJson(request)
    if (!activityConfig.enabled) throw new HttpError(409, 'ACTIVITY_DISABLED', '活动暂未开放或已结束')
    const point = parsePointQr(request.body?.result, runtime.publicOrigin, activityConfig.points)
    const progress = await userProgress(pool, request.currentUser, activityConfig, runtime.publicOrigin)
    setCurrentPoint(request.session, activityConfig, point.key)
    await saveSession(request)
    response.json({ ok: true, data: { point, alreadyCompleted: progress.completedKeys.includes(point.key) } })
  })

  if (runtime.mockEnabled) {
    // Fixed development choices, not a browser-supplied OpenID or a second business-data system.
    const identities = { 'visitor-a': 'development:visitor-a', 'visitor-b': 'development:visitor-b' }
    app.post('/api/dev/login', async (request, response) => {
      requireSameOriginJson(request)
      if (!pool || !sessionsAvailable) unavailable()
      const identity = request.body?.identity
      if (typeof identity !== 'string' || !Object.hasOwn(identities, identity) || Object.hasOwn(request.body, 'openid')) {
        throw new HttpError(400, 'INVALID_DEMO_IDENTITY', '请选择开发演示游客 A 或 B')
      }
      const user = await findOrCreateUser(pool, identities[identity])
      await login(request, user, true)
      response.json({ ok: true, data: await userProgress(pool, user, activityConfig, runtime.publicOrigin) })
    })
  }
}
