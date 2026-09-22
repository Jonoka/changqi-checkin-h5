import { randomBytes, timingSafeEqual } from 'node:crypto'
import { HttpError, sendPage } from './http.js'
import { cookieName, discardSession, regenerateSession, saveSession } from './session.js'
import { findOrCreateUser, requireUserSession, userProgress } from './identity.js'
import { parsePointQr, safeReturnTo } from './wechat.js'

export function mountGuide(app, activity, runtime) {
  app.get('/q/:pointKey', (request, response) => {
    const point = activity.points.find((item) => item.key === request.params.pointKey)
    if (!point) return sendPage(response, { status: 404, title: '地点不存在', code: 'INVALID_POINT', message: '地点不存在，请扫描现场活动二维码', demo: runtime.mockEnabled })
    return sendPage(response, {
      title: '参与方式', demo: runtime.mockEnabled, guide: true,
      message: activity.wechat.guideText,
      officialAccountName: activity.wechat.officialAccountName,
      officialAccountQr: activity.wechat.officialAccountQr,
      activityName: activity.activityName
    })
  })
}

export function mountIdentityAndScan(app, { pool, runtime, wechatClient, sessionsAvailable, activityConfig }) {
  const unavailable = () => { throw new HttpError(503, 'AUTH_UNAVAILABLE', '微信身份服务尚未配置完成，暂可浏览活动；请稍后重试') }
  const authHandler = (handler) => async (request, response) => {
    response.set('Cache-Control', 'no-store')
    try { await handler(request, response) } catch (error) {
      await discardSession(request)
      response.clearCookie(cookieName, { path: '/', httpOnly: true, sameSite: 'lax', secure: runtime.secureCookie })
      const failure = error instanceof HttpError ? error : new HttpError(500, 'LOGIN_FAILED', '暂时无法恢复身份，请稍后重新授权')
      if (!(error instanceof HttpError)) console.error('Identity request failed')
      sendPage(response, { status: failure.status, title: '授权未完成', message: failure.message, code: failure.code, retry: true, demo: runtime.mockEnabled })
    }
  }
  async function login(request, user, developmentIdentity = false) {
    await regenerateSession(request)
    request.session.userId = String(user.id)
    request.session.developmentIdentity = developmentIdentity
    await saveSession(request)
  }
  const requireUser = requireUserSession(pool, runtime)
  function requireSameOriginJson(request) {
    const origin = request.get('origin')
    if (origin && origin !== runtime.publicOrigin) throw new HttpError(403, 'INVALID_ORIGIN', '请从本活动页面操作')
    if (!request.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', '请通过活动页面提交扫码结果')
  }

  app.get('/auth/wechat', authHandler(async (request, response) => {
    if (!pool || !sessionsAvailable || !wechatClient) unavailable()
    const returnTo = safeReturnTo(request.query.returnTo, runtime.publicOrigin)
    await regenerateSession(request)
    const state = randomBytes(24).toString('hex')
    request.session.oauth = { state, returnTo, createdAt: Date.now() }
    await saveSession(request)
    response.redirect(302, wechatClient.authorizationUrl(state))
  }))

  app.get('/auth/callback', authHandler(async (request, response) => {
    if (!pool || !sessionsAvailable || !wechatClient) unavailable()
    const pending = request.session?.oauth
    const state = request.query.state
    if (!pending || typeof state !== 'string' || !/^[a-f0-9]{48}$/.test(state) || state.length !== pending.state.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state)) || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      throw new HttpError(400, 'OAUTH_STATE_INVALID', '授权信息已失效或不匹配，请重新授权')
    }
    const returnTo = safeReturnTo(pending.returnTo, runtime.publicOrigin)
    delete request.session.oauth
    await saveSession(request)
    const code = request.query.code
    if (typeof code !== 'string' || !code || code.length > 512) throw new HttpError(400, 'AUTH_CANCELLED', '授权未完成或已取消，请重新授权')
    const openid = await wechatClient.exchangeCode(code)
    const user = await findOrCreateUser(pool, openid)
    await login(request, user)
    response.redirect(302, returnTo)
  }))

  app.get('/api/me', requireUser, async (request, response) => {
    response.json({ ok: true, data: await userProgress(pool, request.currentUser, activityConfig, runtime.publicOrigin) })
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
    request.session.scannedPointKey = point.key
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
