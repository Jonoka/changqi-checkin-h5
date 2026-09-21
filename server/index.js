import 'dotenv/config'
import http from 'node:http'
import { createApp } from './app.js'
import { loadActivityConfig } from './config.js'
import { checkDatabaseConnection, createDatabasePool, databaseSettings, hasDatabaseSettings } from './db.js'

const port = Number(process.env.PORT || 3000)
const activityConfig = loadActivityConfig()
const settings = databaseSettings()
const production = process.env.NODE_ENV === 'production'
const requireDatabase = production || process.env.REQUIRE_DB === 'true'
let pool = null

if (production) {
  for (const key of ['PUBLIC_ORIGIN', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'SESSION_SECRET', 'UPLOAD_DIR']) {
    if (!process.env[key]) throw new Error(`${key} is required in production`)
  }
  if (process.env.DEV_MOCK_ENABLED === 'true') throw new Error('DEV_MOCK_ENABLED cannot be true in production')
}

if (hasDatabaseSettings(settings)) {
  pool = createDatabasePool(settings)
} else if (requireDatabase) {
  throw new Error('Database settings are required in production')
} else {
  console.warn('Database settings are incomplete; starting without a database connection')
}

const app = createApp({ activityConfig, pool })
const server = http.createServer(app)

if (pool) await checkDatabaseConnection(pool)
server.listen(port, () => console.log(`changqi-checkin-h5 listening on ${port}`))

function close() {
  server.close(async () => {
    if (pool) await pool.end()
    process.exit(0)
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
