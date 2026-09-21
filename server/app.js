import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { publicActivityConfig } from './config.js'
import { runtimeConfig } from './runtime.js'
import { HttpError, sendApiError, sendPage } from './http.js'
import { mountGuide, mountIdentityAndScan } from './a1.js'
import { mountCheckins } from './checkins.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const webDistDirectory = path.resolve(serverDirectory, '..', 'web', 'dist')

function isApiRequest(request) {
  return request.path === '/api' || request.path.startsWith('/api/')
}

export function createApp({ activityConfig, pool = null, runtime = runtimeConfig(), sessionMiddleware = null, wechatClient = null }) {
  const app = express()
  app.disable('x-powered-by')
  if (runtime.secureCookie) app.set('trust proxy', 1)
  app.use(['/api', '/auth'], (_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/activity', (_request, response) => {
    response.json({ ok: true, data: {
      ...publicActivityConfig(activityConfig),
      developmentDemo: runtime.mockEnabled,
      wechatLoginAvailable: Boolean(wechatClient && sessionMiddleware),
      publicOrigin: runtime.publicOrigin
    } })
  })

  app.get('/health', async (_request, response) => {
    if (!pool) return response.status(503).json({ ok: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database is not configured' } })
    try {
      await pool.query('SELECT 1')
      return response.json({ ok: true, data: { database: 'connected' } })
    } catch {
      return response.status(503).json({ ok: false, error: { code: 'DB_UNAVAILABLE', message: 'Database is unavailable' } })
    }
  })

  // Public guide routes never load or mutate a user session, even with a login cookie.
  mountGuide(app, activityConfig, runtime)
  if (sessionMiddleware) app.use(['/api', '/auth'], sessionMiddleware)
  mountIdentityAndScan(app, { pool, runtime, wechatClient, sessionsAvailable: Boolean(sessionMiddleware), activityConfig })
  mountCheckins(app, { pool, runtime, activityConfig })
  app.use('/auth', (_request, response) => sendPage(response, { status: 404, title: '入口不存在', message: '请从公众号菜单重新进入活动' }))

  app.use((request, response, next) => {
    if (isApiRequest(request)) return sendApiError(response, 404, 'NOT_FOUND', '接口不存在')
    next()
  })

  if (fs.existsSync(webDistDirectory)) {
    app.use(express.static(webDistDirectory))
    app.use((request, response, next) => {
      if (request.method === 'GET') return response.sendFile(path.join(webDistDirectory, 'index.html'))
      next()
    })
  } else {
    app.get('/', (_request, response) => response.type('text').send('Frontend is not built. Run npm run build first.'))
  }

  app.use(async (error, request, response, next) => {
    if (response.headersSent || response.destroyed) return next(error)
    // Early multipart rejection (for example 401) must consume/discard the remaining stream.
    // Otherwise a proxy can observe a TCP reset instead of the intended JSON error. No file is saved.
    if (isApiRequest(request) && request.is('multipart/form-data') && !request.readableEnded && !request.destroyed) {
      await new Promise((resolve) => {
        const done = () => { request.off('end', done); request.off('close', done); resolve() }
        request.once('end', done)
        request.once('close', done)
        request.resume()
      })
      if (response.destroyed) return
    }
    if (isApiRequest(request)) {
      if (error.type === 'entity.parse.failed') return sendApiError(response, 400, 'INVALID_JSON', '请求体不是有效 JSON')
      if (error instanceof HttpError) return sendApiError(response, error.status, error.code, error.message)
      console.error('API request failed')
      return sendApiError(response, 500, 'INTERNAL_ERROR', '服务器暂时无法处理请求')
    }
    if (response.headersSent) return next(error)
    return sendPage(response, { status: 500, title: '暂时无法打开页面', message: '请返回公众号菜单重试' })
  })

  return app
}
