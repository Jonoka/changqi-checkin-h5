import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from 'mysql2/promise'
import { createServer as createViteServer } from 'vite'
import { createApp } from '../server/app.js'
import { loadActivityConfig } from '../server/config.js'
import { createDatabasePool } from '../server/db.js'
import { runtimeConfig } from '../server/runtime.js'
import { createMysqlSession } from '../server/session.js'
import { createWechatClient } from '../server/wechat.js'
import { findOrCreateUser } from '../server/identity.js'
import { checkA1Browser } from './check-a1-browser.mjs'

// Intentionally no DB_* fallback: only an explicitly selected local test instance is allowed.
const settings = {
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD || ''
}
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(settings.host), 'Set TEST_DB_HOST to an independent loopback MySQL test instance')
assert.ok(Number.isInteger(settings.port) && settings.port > 0 && settings.user, 'Set TEST_DB_PORT and TEST_DB_USER explicitly')
assert.ok(process.env.npm_execpath, 'Run this script through npm run test:a1:mysql')
const database = `changqi_a1_test_${randomBytes(6).toString('hex')}`
const tempDirectory = path.resolve('tmp', database)
const envFile = path.join(tempDirectory, '.env')
const sessionSecret = randomBytes(32).toString('hex')
let admin, pool, sessions, server, child, vite
let createdDatabase = false
let passed = 0
const activity = loadActivityConfig()
const initialEnabled = activity.enabled
const ok = (name) => { passed++; console.log(`PASS ${passed}: ${name}`) }

function cleanChildEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('DB_') || key.startsWith('WECHAT_') || ['NODE_ENV', 'DEV_MOCK_ENABLED', 'PUBLIC_ORIGIN', 'SESSION_SECRET', 'PORT', 'REQUIRE_DB'].includes(key)) delete env[key]
  }
  env.DOTENV_CONFIG_PATH = envFile
  env.DOTENV_CONFIG_QUIET = 'true'
  return env
}

async function writeTestEnv(overrides = {}) {
  const values = {
    NODE_ENV: 'development', PUBLIC_ORIGIN: 'http://localhost:3000', PORT: '0',
    DEV_MOCK_ENABLED: 'true', SESSION_SECRET: sessionSecret, TZ: 'Asia/Shanghai',
    DB_HOST: settings.host, DB_PORT: String(settings.port), DB_USER: settings.user,
    DB_PASSWORD: settings.password, DB_NAME: database, REQUIRE_DB: 'true', ...overrides
  }
  // JSON quoting is sufficient for ordinary local test credentials; reject multiline dotenv values.
  for (const value of Object.values(values)) assert.doesNotMatch(value, /[\r\n]/)
  const content = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n'
  await fs.writeFile(envFile, content, { mode: 0o600 })
}

async function runNode(args, env) {
  const process = spawn(globalThis.process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  process.stdout.on('data', (data) => { stdout += data })
  process.stderr.on('data', (data) => { stderr += data })
  const [code] = await once(process, 'exit')
  assert.equal(code, 0, `Child command failed: ${args.join(' ')}; inspect local setup (output intentionally not dumped)`)
  return { stdout, stderr }
}

function browser(baseUrl) {
  return {
    cookie: '',
    async request(route, { body, method, ...options } = {}) {
      const headers = { ...options.headers }
      if (this.cookie) headers.cookie = this.cookie
      if (body !== undefined) headers['content-type'] = 'application/json'
      const response = await fetch(`${baseUrl}${route}`, {
        ...options, redirect: 'manual', method: method || (body === undefined ? 'GET' : 'POST'), headers,
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000)
      })
      const setCookie = response.headers.getSetCookie()
      for (const cookie of setCookie) if (cookie.startsWith('changqi.sid=')) this.cookie = cookie.split(';')[0]
      const text = await response.text()
      const payload = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null
      return { status: response.status, payload, text, headers: response.headers }
    }
  }
}

async function savedSession(client) {
  const encoded = client.cookie.slice('changqi.sid='.length)
  const signed = decodeURIComponent(encoded)
  const id = signed.slice(2, signed.lastIndexOf('.'))
  const [rows] = await pool.execute('SELECT data FROM sessions WHERE session_id = ?', [id])
  return rows[0] ? JSON.parse(rows[0].data) : null
}

async function count(table) {
  assert.ok(['users', 'checkins', 'sessions'].includes(table))
  const [rows] = await pool.query(`SELECT COUNT(*) AS count FROM ${table}`)
  return Number(rows[0].count)
}

function simulatedWechat(publicOrigin) {
  return createWechatClient({
    publicOrigin, appId: 'simulated-app', appSecret: 'simulated-secret',
    fetchImpl: async (value) => {
      const url = new URL(value)
      if (url.pathname === '/sns/oauth2/access_token') {
        const code = url.searchParams.get('code')
        if (code === 'network-failure') throw new Error('simulated private upstream error')
        if (code === 'invalid-code') return { ok: true, json: async () => ({ errcode: 40029, errmsg: 'simulated invalid code' }) }
        if (code === 'non-json') return { ok: true, json: async () => { throw new Error('simulated non-JSON') } }
        assert.ok(['user-a', 'user-b', 'proxy-user'].includes(code), 'Unrecognized mock code must not establish identity')
        return { ok: true, json: async () => ({ openid: `simulated-${code}`, access_token: 'simulated-oauth-token' }) }
      }
      if (url.pathname === '/cgi-bin/stable_token') return { ok: true, json: async () => ({ access_token: 'simulated-token', expires_in: 7200 }) }
      if (url.pathname === '/cgi-bin/ticket/getticket') return { ok: true, json: async () => ({ errcode: 0, ticket: 'simulated-ticket', expires_in: 7200 }) }
      throw new Error('Unexpected provider URL in simulated WeChat client')
    }
  })
}

async function openApp({ origin, port = 0, production = false } = {}) {
  server = http.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const runtime = runtimeConfig({ NODE_ENV: production ? 'production' : 'test', PUBLIC_ORIGIN: origin || baseUrl,
    SESSION_SECRET: sessionSecret, WECHAT_APP_ID: 'simulated-app', WECHAT_APP_SECRET: 'simulated-secret', UPLOAD_DIR: '/test-only' })
  sessions = await createMysqlSession(pool, runtime)
  const app = createApp({ activityConfig: activity, pool, runtime, sessionMiddleware: sessions.middleware, wechatClient: simulatedWechat(runtime.publicOrigin) })
  server.on('request', app)
  return { baseUrl, runtime }
}

async function closeApp() {
  if (server) { await new Promise((resolve) => server.close(resolve)); server = null }
  if (sessions) { await sessions.store.close(); sessions = null }
}

async function beginOAuth(client, returnTo = '/#point/p01') {
  const started = await client.request(`/auth/wechat?returnTo=${encodeURIComponent(returnTo)}`)
  assert.equal(started.status, 302)
  const location = new URL(started.headers.get('location'))
  assert.equal(location.searchParams.get('scope'), 'snsapi_base')
  assert.match(started.headers.get('set-cookie'), /HttpOnly/i)
  assert.match(started.headers.get('set-cookie'), /SameSite=Lax/i)
  return location
}

async function oauth(client, code) {
  const location = await beginOAuth(client)
  const callback = await client.request(`/auth/callback?state=${location.searchParams.get('state')}&code=${code}`)
  assert.equal(callback.status, 302)
  assert.equal(callback.headers.get('location'), '/#point/p01')
  return (await client.request('/api/me')).payload.data
}

async function startRealProcess() {
  child = spawn(process.execPath, ['server/index.js'], { env: cleanChildEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (data) => { output += data })
  child.stderr.on('data', () => { /* No raw database error or local secret output. */ })
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = /listening on (\d+)/.exec(output)
    if (match) return `http://127.0.0.1:${match[1]}`
    assert.equal(child.exitCode, null, 'Actual application process exited before listening')
    await delay(50)
  }
  throw new Error('Actual application did not start within the local startup budget')
}

async function stopRealProcess() {
  if (!child) return
  const current = child
  child = null
  if (current.exitCode === null && current.signalCode === null) {
    const exited = once(current, 'exit')
    current.kill('SIGTERM') // Only the child created by this test, not any existing server.
    await exited
  }
}

try {
  admin = await mysql.createConnection({ ...settings, multipleStatements: false })
  const [version] = await admin.query('SELECT VERSION() AS version')
  assert.match(version[0].version, /^8\./, 'This check is exercised with MySQL 8; no SQLite/in-memory substitute')
  console.log(`Independent loopback MySQL ${version[0].version}; WeChat responses are SIMULATED`)
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  createdDatabase = true
  await fs.mkdir(tempDirectory, { recursive: true })
  await writeTestEnv()
  const childEnv = cleanChildEnv()
  for (const key of Object.keys(childEnv)) assert.ok(!key.startsWith('DB_'), 'Schema child must receive DB settings only from the generated .env')
  const schemaResult = await runNode([process.env.npm_execpath, 'run', 'db:schema'], childEnv)
  assert.match(schemaResult.stdout, /schema applied: 2 tables/)
  pool = createDatabasePool({ ...settings, database })
  ok('dotenv-only npm run db:schema creates users/checkins in a newly created isolated MySQL database')
  const override = await runNode(['--input-type=module', '-e', "import 'dotenv/config'; if(process.env.DB_NAME !== 'external_override_probe') process.exit(2); console.log('dotenv override preserved')"], { ...childEnv, DB_NAME: 'external_override_probe' })
  assert.match(override.stdout, /override preserved/)
  ok('dotenv preserves explicit environment-variable precedence')

  const { baseUrl, runtime } = await openApp()
  const anonymous = browser(baseUrl)
  for (const route of ['/api/me', '/api/scan', '/api/wechat/js-config']) {
    const result = await anonymous.request(route, route === '/api/scan' ? { body: { result: `${baseUrl}/q/p01` } } : {})
    assert.equal(result.status, 401)
    assert.equal(result.payload.error.code, 'NEED_LOGIN')
  }
  assert.equal(await count('sessions'), 0)
  ok('anonymous APIs return JSON 401/NEED_LOGIN without creating a session')

  const a = browser(baseUrl), aAgain = browser(baseUrl), b = browser(baseUrl)
  const aMe = await oauth(a, 'user-a')
  const initialSession = await savedSession(a)
  const aUser = await findOrCreateUser(pool, 'simulated-user-a')
  assert.equal(aMe.completedCount, 0)
  assert.equal(aMe.totalCount, activity.points.length)
  assert.equal(aMe.claimUrl, null)
  assert.deepEqual(Object.keys(aMe).sort(), ['allCompleted', 'claimUrl', 'claimedAt', 'completedCount', 'completedKeys', 'totalCount', 'userLabel'])
  const beforeRepeat = await count('users')
  assert.equal((await oauth(aAgain, 'user-a')).userLabel, aMe.userLabel)
  assert.equal(await count('users'), beforeRepeat)
  assert.equal((await findOrCreateUser(pool, 'simulated-user-a')).claim_code, aUser.claim_code)
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => findOrCreateUser(pool, 'simulated-race-user')))
  assert.equal(new Set(concurrent.map((user) => String(user.id))).size, 1)
  const caseUpper = await findOrCreateUser(pool, 'simulated-CaseUser')
  const caseLower = await findOrCreateUser(pool, 'simulated-caseuser')
  assert.notEqual(String(caseUpper.id), String(caseLower.id))
  const bMe = await oauth(b, 'user-b')
  assert.notEqual(bMe.userLabel, aMe.userLabel)
  assert.notEqual(a.cookie, b.cookie)
  assert.equal(initialSession.userId, String(aUser.id))
  ok('OpenID login is idempotent (including concurrent creation), claim_code remains fixed, and case-sensitive identities have isolated sessions')

  await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path) VALUES (?, ?, ?), (?, ?, ?)', [aUser.id, 'p01', 'TEST-FIXTURE-NO-PHOTO', aUser.id, 'retired-key', 'TEST-FIXTURE-NO-PHOTO'])
  const stateA = (await a.request('/api/me')).payload.data
  const stateB = (await b.request('/api/me')).payload.data
  assert.deepEqual(stateA.completedKeys, ['p01'])
  assert.equal(stateA.completedCount, 1)
  assert.equal(stateB.completedCount, 0)
  assert.equal(stateA.allCompleted, false)
  assert.equal(stateA.claimUrl, null)
  assert.doesNotMatch(JSON.stringify(stateA), /openid|photo_path|TEST-FIXTURE|claim_code|simulated-user/)
  ok('two users see isolated real SQL progress; unrelated historical keys do not count and private fields stay server-side')

  const beforeGuide = await savedSession(a)
  for (const visitor of [anonymous, a]) {
    const guide = await visitor.request('/q/p01')
    assert.equal(guide.status, 200)
    assert.match(guide.text, /印象芦苞/)
    assert.match(guide.text, /底部菜单/)
    assert.equal(guide.headers.get('set-cookie'), null)
    assert.equal((await visitor.request('/q/not-a-point')).status, 404)
  }
  assert.deepEqual(await savedSession(a), beforeGuide)
  ok('/q/p01 always guides anonymous and logged-in visitors without reading/writing their session or granting scan eligibility')

  const beforeScanCount = await count('checkins')
  const scan = await a.request('/api/scan', { body: { result: `${runtime.publicOrigin}/q/p02` } })
  assert.equal(scan.status, 200)
  assert.equal(scan.payload.data.point.key, 'p02')
  assert.equal(scan.payload.data.alreadyCompleted, false)
  assert.equal((await savedSession(a)).scannedPointKey, 'p02')
  assert.equal((await savedSession(b)).scannedPointKey, undefined)
  assert.deepEqual((await a.request('/api/me')).payload.data, stateA)
  const completed = await a.request('/api/scan', { body: { result: `${runtime.publicOrigin}/q/p01` } })
  assert.equal(completed.payload.data.alreadyCompleted, true)
  for (const result of [`${runtime.publicOrigin}.evil.test/q/p01`, 'https://evil.test/q/p01', `${runtime.publicOrigin}/r/0123456789`, `${runtime.publicOrigin}/bad/p01`, `${runtime.publicOrigin}/q/missing`, `${runtime.publicOrigin}/q/%70%30%31`, `${runtime.publicOrigin}/q/p01?test=1`]) {
    const invalid = await a.request('/api/scan', { body: { result } })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.payload.error.code, 'INVALID_QR')
    assert.equal((await savedSession(a)).scannedPointKey, 'p01')
  }
  assert.equal(await count('checkins'), beforeScanCount)
  assert.deepEqual((await a.request('/api/me')).payload.data, stateA)
  ok('valid scan is durably saved before success; completed status is real; invalid URL/host/path/key/claim codes never alter eligibility or progress')

  activity.enabled = false
  const closed = await a.request('/api/scan', { body: { result: `${runtime.publicOrigin}/q/p02` } })
  assert.equal(closed.status, 409)
  assert.equal(closed.payload.error.code, 'ACTIVITY_DISABLED')
  assert.deepEqual((await a.request('/api/me')).payload.data, stateA)
  assert.equal(await count('checkins'), beforeScanCount)
  activity.enabled = initialEnabled
  ok('disabled activity refuses new scanning while existing progress remains readable')

  const configured = await a.request(`/api/wechat/js-config?url=${encodeURIComponent(`${runtime.publicOrigin}/?a=1#point/p01`)}`)
  assert.equal(configured.status, 200)
  assert.deepEqual(configured.payload.data.jsApiList, ['scanQRCode'])
  assert.doesNotMatch(JSON.stringify(configured.payload), /secret|simulated-ticket|simulated-token/)
  const badUrl = await a.request('/api/wechat/js-config?url=https%3A%2F%2Fevil.test%2F')
  assert.equal(badUrl.status, 400)
  ok('JS-SDK configuration validates the application origin and exposes no secret or service token (WeChat network simulated)')

  const failures = [
    { state: '0'.repeat(48), code: 'user-a', expected: 'OAUTH_STATE_INVALID' },
    { state: '汉'.repeat(48), code: 'user-a', expected: 'OAUTH_STATE_INVALID' },
    { code: '', expected: 'AUTH_CANCELLED' },
    { code: 'invalid-code', expected: 'WECHAT_UNAVAILABLE' },
    { code: 'network-failure', expected: 'WECHAT_UNAVAILABLE' },
    { code: 'non-json', expected: 'WECHAT_UNAVAILABLE' }
  ]
  const beforeFailures = await count('users')
  for (const failure of failures) {
    const visitor = browser(baseUrl)
    const authorization = await beginOAuth(visitor)
    const state = failure.state || authorization.searchParams.get('state')
    const result = await visitor.request(`/auth/callback?state=${encodeURIComponent(state)}&code=${failure.code}`)
    assert.notEqual(result.status, 302)
    assert.match(result.text, new RegExp(failure.expected))
    assert.match(result.text, /重新授权/)
    assert.doesNotMatch(result.text, /simulated private|simulated-secret/)
    assert.equal((await visitor.request('/api/me')).status, 401)
  }
  assert.equal(await count('users'), beforeFailures)
  const invalidReturn = await anonymous.request('/auth/wechat?returnTo=%2F%2Fevil.test')
  assert.equal(invalidReturn.status, 400)
  ok('state mismatch/non-ASCII mismatch/cancel/invalid code/WeChat failure do not establish a login or create users; no automatic redirect loop')

  const expired = browser(baseUrl)
  await oauth(expired, 'user-b')
  const expiredSid = decodeURIComponent(expired.cookie.split('=')[1]).slice(2).split('.')[0]
  await pool.execute('UPDATE sessions SET expires = ? WHERE session_id = ?', [1, expiredSid])
  assert.equal((await expired.request('/api/me')).status, 401)
  ok('expired MySQL sessions return JSON NEED_LOGIN')
  await closeApp()

  // Kill and replace a real server/index.js child, not just reconstruct an in-memory Express application.
  let processOrigin = await startRealProcess()
  const demo = browser(processOrigin)
  const demonstration = await demo.request('/api/dev/login', { body: { identity: 'visitor-a' } })
  assert.equal(demonstration.status, 200)
  const demoUser = await findOrCreateUser(pool, 'development:visitor-a')
  await pool.execute('INSERT INTO checkins (user_id, point_key, photo_path) VALUES (?, ?, ?)', [demoUser.id, 'p01', 'TEST-RESTART-FIXTURE'])
  const demoBefore = (await demo.request('/api/me')).payload.data
  assert.equal((await demo.request('/api/scan', { body: { result: 'http://localhost:3000/q/p02' } })).status, 200)
  assert.equal((await savedSession(demo)).scannedPointKey, 'p02')
  const durableCookie = demo.cookie
  const oldPid = child.pid
  await stopRealProcess()
  processOrigin = await startRealProcess()
  assert.notEqual(child.pid, oldPid)
  const restored = browser(processOrigin)
  restored.cookie = durableCookie
  assert.deepEqual((await restored.request('/api/me')).payload.data, demoBefore)
  assert.equal((await savedSession(restored)).scannedPointKey, 'p02')
  const demoB = browser(processOrigin)
  assert.equal((await demoB.request('/api/dev/login', { body: { identity: 'visitor-b' } })).payload.data.completedCount, 0)
  assert.equal((await restored.request('/api/dev/login', { body: { identity: 'visitor-a', openid: 'forged' } })).status, 400)
  assert.equal((await restored.request('/api/activity')).payload.data.developmentDemo, true)
  await stopRealProcess()
  ok('ACTUAL Node application process restart restores MySQL session, identity, scanned point and progress; explicit demo uses the same real database')

  const production = await openApp({ production: true, origin: 'https://activity.example.test' })
  const prodBrowser = browser(production.baseUrl)
  assert.equal((await prodBrowser.request('/api/dev/login', { body: { identity: 'visitor-a' } })).status, 404)
  prodBrowser.cookie = durableCookie
  assert.equal((await prodBrowser.request('/api/me')).status, 401)
  assert.equal((await prodBrowser.request('/api/activity')).payload.data.developmentDemo, false)
  await closeApp()
  ok('production has no mock login endpoint and rejects a previously saved development identity')

  // Exercise the existing Vite proxy itself, including callback and public guide paths.
  await openApp({ origin: 'http://localhost:5173', port: 3000 })
  vite = await createViteServer({ configFile: path.resolve('web/vite.config.js'), logLevel: 'error', server: { host: '127.0.0.1', port: 5173, strictPort: true } })
  await vite.listen()
  const proxied = browser('http://127.0.0.1:5173')
  assert.match((await proxied.request('/')).text, /\/src\/main.js/)
  assert.equal((await proxied.request('/api/activity')).status, 200)
  assert.equal((await proxied.request('/api/does-not-exist')).status, 404)
  assert.match((await proxied.request('/q/p01')).text, /公众号入口引导/)
  const proxyOAuth = await beginOAuth(proxied)
  assert.equal(proxyOAuth.searchParams.get('redirect_uri'), 'http://localhost:5173/auth/callback')
  const callback = await proxied.request(`/auth/callback?state=${proxyOAuth.searchParams.get('state')}&code=proxy-user`)
  assert.equal(callback.status, 302)
  assert.equal(callback.headers.get('location'), '/#point/p01')
  assert.equal((await proxied.request('/api/me')).status, 200)
  assert.equal((await proxied.request('/api/scan', { body: { result: 'http://localhost:5173/q/p01' } })).status, 200)
  if (process.env.TEST_BROWSER_EXECUTABLE) {
    const rowsBeforeBrowser = await count('checkins')
    await checkA1Browser({
      executable: process.env.TEST_BROWSER_EXECUTABLE, directory: tempDirectory,
      origin: 'http://localhost:5173', cookie: proxied.cookie, totalCount: activity.points.length,
      afterView: async () => { assert.equal((await savedSession(proxied)).scannedPointKey, 'p01'); assert.equal(await count('checkins'), rowsBeforeBrowser) },
      afterScan: async () => { assert.equal((await savedSession(proxied)).scannedPointKey, 'p02'); assert.equal(await count('checkins'), rowsBeforeBrowser) }
    })
    ok('ACTUAL Chromium/Vue page: real MySQL identity and unchanged progress, map-only view, SDK cancel/fail/retry/resume, reload and ordinary-browser hint; SDK SIMULATED; 390/430px no overflow')
  } else {
    console.log('SKIP optional rendered-browser check: TEST_BROWSER_EXECUTABLE not supplied (simulated SDK unit checks run in npm run check)')
  }
  await vite.close(); vite = null
  await closeApp()
  ok('ACTUAL Vite :5173 proxy reaches :3000 API, OAuth start/callback and /q guide; callback returns to the frontend origin')

  console.log(`A1 MySQL checks passed: ${passed}; actual MySQL/process restart/proxy, SIMULATED WeChat network, no camera/device claim`)
} finally {
  activity.enabled = initialEnabled
  if (vite) await vite.close()
  await stopRealProcess()
  await closeApp()
  if (pool) await pool.end()
  // The only dropped database is the random test database this invocation created successfully.
  if (admin && createdDatabase && /^changqi_a1_test_[a-f0-9]{12}$/.test(database)) await admin.query(`DROP DATABASE \`${database}\``)
  if (admin) await admin.end()
  // Remove only this invocation's generated credential file; leave reports / other local data untouched.
  await fs.rm(envFile, { force: true })
}
