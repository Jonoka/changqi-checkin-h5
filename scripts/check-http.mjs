import assert from 'node:assert/strict'
import http from 'node:http'
import { createApp } from '../server/app.js'
import { loadActivityConfig } from '../server/config.js'

const app = createApp({
  activityConfig: loadActivityConfig(),
  pool: { query: async () => { throw new Error('test database failure') } }
})
const server = http.createServer(app)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`

async function jsonResponse(url, options) {
  const response = await fetch(`${baseUrl}${url}`, options)
  return { response, payload: await response.json() }
}

try {
  const activity = await jsonResponse('/api/activity')
  assert.equal(activity.response.status, 200)
  assert.equal(activity.payload.ok, true)

  const page = await fetch(`${baseUrl}/`)
  assert.equal(page.status, 200)
  const pageBody = await page.text()
  assert.match(pageBody, /<!doctype html>|Frontend is not built/i)

  const unknown = await jsonResponse('/api/does-not-exist')
  assert.equal(unknown.response.status, 404)
  assert.deepEqual(unknown.payload, { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } })

  const invalidJson = await jsonResponse('/api/does-not-exist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  })
  assert.equal(invalidJson.response.status, 400)
  assert.deepEqual(invalidJson.payload, { ok: false, error: { code: 'INVALID_JSON', message: '请求体不是有效 JSON' } })

  const health = await jsonResponse('/health')
  assert.equal(health.response.status, 503)
  assert.deepEqual(health.payload, { ok: false, error: { code: 'DB_UNAVAILABLE', message: 'Database is unavailable' } })
  console.log('http checks ok: page, activity API, API 404, invalid JSON, database error')
} finally {
  await new Promise((resolve) => server.close(resolve))
}
