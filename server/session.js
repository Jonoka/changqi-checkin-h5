import session from 'express-session'
import mysqlSession from 'express-mysql-session'
import { HttpError } from './http.js'

const MySQLStore = mysqlSession(session)
export const cookieName = 'changqi.sid'
const lifetime = 7 * 24 * 60 * 60 * 1000

export async function createMysqlSession(pool, runtime) {
  const store = new MySQLStore({
    createDatabaseTable: true,
    endConnectionOnClose: false,
    expiration: lifetime
  }, pool)
  // Do not expose adapter error objects: they may include connection details.
  store.on('error', () => console.error('Session storage is temporarily unavailable'))
  try { await store.onReady() } catch (error) { await store.close(); throw error }
  const middleware = session({
    name: cookieName,
    secret: runtime.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: runtime.secureCookie, maxAge: lifetime, path: '/' }
  })
  return { store, middleware }
}

export async function discardSession(request) {
  const current = request.session
  if (current) await new Promise((resolve) => current.destroy(() => resolve()))
  // In particular, never allow express-session's response hook to retry a failed login save.
  request.session = null
}

export async function saveSession(request) {
  try {
    await new Promise((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()))
  } catch {
    await discardSession(request)
    throw new HttpError(500, 'SAVE_FAILED', '会话保存失败，请重新进入活动后再试')
  }
}

export async function regenerateSession(request) {
  try {
    await new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()))
  } catch {
    await discardSession(request)
    throw new HttpError(500, 'SAVE_FAILED', '会话暂时无法建立，请稍后重试')
  }
}
