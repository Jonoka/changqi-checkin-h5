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
  return {
    production, mockEnabled, sessionSecret,
    publicOrigin: origin.origin,
    secureCookie: origin.protocol === 'https:',
    appId: env.WECHAT_APP_ID || '',
    appSecret: env.WECHAT_APP_SECRET || '',
    wechatConfigured
  }
}
