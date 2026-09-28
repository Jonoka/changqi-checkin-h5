import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function within(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function runtimeConfig(env = process.env) {
  const mode = env.NODE_ENV || 'development'
  const production = mode === 'production'
  const mockValue = env.DEV_MOCK_ENABLED || 'false'
  if (!['true', 'false'].includes(mockValue)) throw new Error('DEV_MOCK_ENABLED must be true or false')
  const mockEnabled = mockValue === 'true'
  if (mockEnabled && !['development', 'test'].includes(mode)) throw new Error('DEV_MOCK_ENABLED is allowed only in development/test')
  if (production && !env.PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN is required in production')
  let origin
  try { origin = new URL(env.PUBLIC_ORIGIN || `http://localhost:${env.PORT || 3000}`) } catch { throw new Error('PUBLIC_ORIGIN must be an absolute application origin') }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('PUBLIC_ORIGIN must contain only scheme and host/port')
  }
  if (production && origin.protocol !== 'https:') throw new Error('PUBLIC_ORIGIN must use HTTPS in production')
  const sessionSecret = env.SESSION_SECRET || ''
  if (sessionSecret && sessionSecret.length < 32) throw new Error('SESSION_SECRET must have at least 32 characters; use a random secret')
  if (production) {
    for (const key of ['WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'SESSION_SECRET', 'UPLOAD_DIR']) {
      if (!env[key]) throw new Error(`${key} is required in production`)
    }
  }
  const wechatConfigured = Boolean(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET)
  if ((mockEnabled || wechatConfigured) && !sessionSecret) throw new Error('SESSION_SECRET is required for identity sessions')
  const uploadDir = path.resolve(env.UPLOAD_DIR || path.join(projectRoot, 'var', 'uploads'))
  if (within(path.join(projectRoot, 'web'), uploadDir)) throw new Error('UPLOAD_DIR must be outside the frontend/public directory')
  if (production && (!path.isAbsolute(env.UPLOAD_DIR) || within(projectRoot, uploadDir))) {
    throw new Error('Production UPLOAD_DIR must be an absolute persistent directory outside the application package')
  }
  // Optional fixed read-only statistics credential; never fall back to public access.
  const statsUser = env.STATS_USER || ''
  const statsPassword = env.STATS_PASSWORD || ''
  if (Boolean(statsUser) !== Boolean(statsPassword)) throw new Error('Configure both STATS_USER and STATS_PASSWORD, or leave statistics disabled')
  if (statsUser && (!/^[A-Za-z0-9._-]{1,64}$/.test(statsUser) || statsPassword.length < 16 || /[\r\n]/.test(statsPassword))) {
    throw new Error('Statistics credentials require a simple username and a random password of at least 16 characters')
  }
  return {
    production, mockEnabled, sessionSecret, uploadDir, statsUser, statsPassword,
    statsExclusionFile: env.STATS_EXCLUDE_CQ_FILE ?? '',
    publicOrigin: origin.origin,
    secureCookie: origin.protocol === 'https:',
    appId: env.WECHAT_APP_ID || '',
    appSecret: env.WECHAT_APP_SECRET || '',
    wechatConfigured
  }
}
