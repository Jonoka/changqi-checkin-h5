import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { publicActivityConfig } from './config.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const webDistDirectory = path.resolve(serverDirectory, '..', 'web', 'dist')

export function createApp({ activityConfig, pool = null }) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/activity', (_request, response) => {
    response.json({ ok: true, data: publicActivityConfig(activityConfig) })
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

  if (fs.existsSync(webDistDirectory)) {
    app.use(express.static(webDistDirectory))
    app.use((request, response, next) => {
      if (request.method === 'GET') return response.sendFile(path.join(webDistDirectory, 'index.html'))
      next()
    })
  } else {
    app.get('/', (_request, response) => response.type('text').send('Frontend is not built. Run npm run build first.'))
  }

  return app
}
