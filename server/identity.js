import { randomBytes } from 'node:crypto'
import { HttpError } from './http.js'

export function requireUserSession(pool, runtime) {
  return async (request, _response, next) => {
    const id = request.session?.userId
    if (typeof id !== 'string' || !/^\d+$/.test(id) || (!runtime.mockEnabled && request.session.developmentIdentity)) {
      throw new HttpError(401, 'NEED_LOGIN', '身份已失效，请重新进入活动')
    }
    const user = pool && await findUser(pool, id)
    if (!user) throw new HttpError(401, 'NEED_LOGIN', '身份已失效，请重新进入活动')
    request.currentUser = user
    next()
  }
}


export async function findUser(pool, id) {
  const [rows] = await pool.execute('SELECT id, claim_code, claimed_at FROM users WHERE id = ?', [id])
  return rows[0] || null
}

// Only server-side OAuth or the explicit development identity mapping calls this function.
export async function findOrCreateUser(pool, openid) {
  if (typeof openid !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(openid)) throw new Error('Invalid server identity response')
  for (let attempt = 0; attempt < 3; attempt++) {
    const [existing] = await pool.execute('SELECT id, claim_code, claimed_at FROM users WHERE openid = ?', [openid])
    if (existing[0]) return existing[0]
    try {
      const [result] = await pool.execute('INSERT INTO users (openid, claim_code) VALUES (?, ?)', [openid, randomBytes(16).toString('hex')])
      return await findUser(pool, String(result.insertId))
    } catch (error) {
      // An OpenID race re-reads the existing user; an extremely rare claim-code collision retries.
      if (error.code !== 'ER_DUP_ENTRY') throw error
    }
  }
  const [existing] = await pool.execute('SELECT id, claim_code, claimed_at FROM users WHERE openid = ?', [openid])
  if (existing[0]) return existing[0]
  throw new Error('Could not allocate a claim code')
}

function chinaTime(value) {
  if (!value) return null
  if (value instanceof Date) return `${new Date(value.getTime() + 8 * 3600000).toISOString().slice(0, 19)}+08:00`
  return `${String(value).replace(' ', 'T')}+08:00`
}

export async function userProgress(pool, user, activity, publicOrigin) {
  const [rows] = await pool.execute('SELECT point_key FROM checkins WHERE user_id = ?', [user.id])
  const saved = new Set(rows.map((row) => row.point_key))
  const completedKeys = [...activity.points].sort((a, b) => a.displayOrder - b.displayOrder).filter((point) => saved.has(point.key)).map((point) => point.key)
  const totalCount = activity.points.length
  const allCompleted = totalCount > 0 && completedKeys.length === totalCount
  return {
    userLabel: `CQ${String(user.id).padStart(6, '0')}`,
    completedKeys,
    completedCount: completedKeys.length,
    totalCount,
    allCompleted,
    claimedAt: chinaTime(user.claimed_at),
    claimUrl: allCompleted ? `${publicOrigin}/r/${user.claim_code}` : null
  }
}
