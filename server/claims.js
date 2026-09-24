import { HttpError } from './http.js'
import { findUser, requireUserSession, userProgress } from './identity.js'

const invalidClaim = () => new HttpError(404, 'INVALID_CLAIM_CODE', '领取凭证不存在，请核对游客出示的领取二维码')

export async function findClaimUser(pool, code) {
  if (typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(code)) throw invalidClaim()
  if (!pool) throw new HttpError(503, 'CLAIM_UNAVAILABLE', '暂时无法读取领取凭证，请稍后重试')
  const [rows] = await pool.execute('SELECT id, claim_code, claimed_at FROM users WHERE claim_code = ?', [code])
  if (!rows[0]) throw invalidClaim()
  return rows[0]
}

export function publicClaimState(state) {
  // The holder sees no photos, OpenID, point history, claim code or private paths.
  const { userLabel, completedCount, totalCount, allCompleted, claimedAt } = state
  return { userLabel, completedCount, totalCount, allCompleted, claimedAt }
}

export async function markClaimed(pool, userId, source, activity, publicOrigin) {
  if (!['self', 'staff'].includes(source)) throw new Error('Invalid server claim source')
  let connection, committing = false, destroyed = false
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    // Same lock and ordering as explicit photo replacement; no late photo switch after a claim.
    const [rows] = await connection.execute('SELECT id, claim_code, claimed_at FROM users WHERE id = ? FOR UPDATE', [userId])
    let user = rows[0]
    if (!user) throw invalidClaim()
    const state = await userProgress(connection, user, activity, publicOrigin)
    if (user.claimed_at) { await connection.rollback(); return state }
    if (!activity.enabled) throw new HttpError(409, 'ACTIVITY_DISABLED', '活动暂未开放或已结束，不能首次确认领取')
    if (!state.allCompleted) throw new HttpError(409, 'NOT_COMPLETED', '尚未完成全部地点，不能确认领取')
    await connection.execute('UPDATE users SET claimed_at = NOW(), claim_source = ? WHERE id = ? AND claimed_at IS NULL', [source, userId])
    user = await findUser(connection, userId)
    if (!user?.claimed_at) throw new Error('Claim write not confirmed')
    const saved = await userProgress(connection, user, activity, publicOrigin)
    committing = true
    await connection.commit()
    return saved
  } catch (error) {
    if (connection) {
      if (committing) { connection.destroy(); destroyed = true }
      else { try { await connection.rollback() } catch { connection.destroy(); destroyed = true } }
    }
    if (error instanceof HttpError) throw error
    console.error('Claim save could not be confirmed')
    throw new HttpError(500, 'SAVE_FAILED', '领取结果暂时无法确认，请先刷新核对状态，不要重复派发礼品')
  } finally { if (connection && !destroyed) connection.release() }
}

function requireClaimRequest(request, runtime) {
  const origin = request.get('origin')
  if ((origin && origin !== runtime.publicOrigin) || request.get('sec-fetch-site') === 'cross-site') {
    throw new HttpError(403, 'INVALID_ORIGIN', '请从本活动领取页面操作')
  }
  if (!request.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', '请通过领取页面确认')
  if (!request.body || Array.isArray(request.body) || Object.keys(request.body).length) {
    throw new HttpError(400, 'INVALID_CLAIM_REQUEST', '领取请求不需要附带身份或渠道，请刷新页面重试')
  }
}

export function mountPublicClaims(app, { pool, runtime, activityConfig }) {
  // Before session middleware: a valid bearer claim link never requires a visitor/staff login.
  app.use('/api/r', (_request, response, next) => { response.set('Referrer-Policy', 'no-referrer'); next() })
  app.get('/api/r/:claimCode', async (request, response) => {
    const user = await findClaimUser(pool, request.params.claimCode)
    response.json({ ok: true, data: publicClaimState(await userProgress(pool, user, activityConfig, runtime.publicOrigin)) })
  })
  app.post('/api/r/:claimCode/claim', async (request, response) => {
    requireClaimRequest(request, runtime)
    const user = await findClaimUser(pool, request.params.claimCode)
    response.json({ ok: true, data: publicClaimState(await markClaimed(pool, user.id, 'staff', activityConfig, runtime.publicOrigin)) })
  })
}

export function mountMyClaim(app, { pool, runtime, activityConfig }) {
  app.post('/api/me/claim', requireUserSession(pool, runtime), async (request, response) => {
    requireClaimRequest(request, runtime)
    response.json({ ok: true, data: await markClaimed(pool, request.currentUser.id, 'self', activityConfig, runtime.publicOrigin) })
  })
}
