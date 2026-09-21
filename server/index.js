import 'dotenv/config'
import http from 'node:http'
import { createApp } from './app.js'
import { loadActivityConfig } from './config.js'
import { checkDatabaseConnection, createDatabasePool, databaseSettings, hasDatabaseSettings } from './db.js'
import { runtimeConfig } from './runtime.js'
import { createMysqlSession } from './session.js'
import { createWechatClient } from './wechat.js'

const port = Number(process.env.PORT || 3000)
const activityConfig = loadActivityConfig()
const settings = databaseSettings()
const runtime = runtimeConfig()
const requireDatabase = runtime.production || runtime.mockEnabled || runtime.wechatConfigured || process.env.REQUIRE_DB === 'true'
let pool = null

if (hasDatabaseSettings(settings)) {
  pool = createDatabasePool(settings)
} else if (requireDatabase) {
  throw new Error('Database settings are required for identity sessions or production')
} else {
  console.warn('Database settings are incomplete; starting without a database connection')
}

let sessions = null
try {
  if (pool) {
    await checkDatabaseConnection(pool)
    if (runtime.sessionSecret) sessions = await createMysqlSession(pool, runtime)
  }
} catch {
  if (sessions) await sessions.store.close()
  if (pool) await pool.end()
  console.error('Database or session initialization failed; check local configuration and schema')
  process.exit(1)
}
const wechatClient = runtime.wechatConfigured ? createWechatClient(runtime) : null
const app = createApp({ activityConfig, pool, runtime, sessionMiddleware: sessions?.middleware, wechatClient })
const server = http.createServer(app)
server.listen(port, () => console.log(`changqi-checkin-h5 listening on ${server.address().port}`))

function close() {
  server.close(async () => {
    if (sessions) await sessions.store.close()
    if (pool) await pool.end()
    process.exit(0)
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
