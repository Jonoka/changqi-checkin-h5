import { createHash, randomBytes } from 'node:crypto'
import { HttpError } from './http.js'

function upstreamError() {
  return new HttpError(502, 'WECHAT_UNAVAILABLE', '微信服务暂时不可用，请稍后重试')
}

export function applicationUrl(value, publicOrigin) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\]/.test(value)) throw new HttpError(400, 'INVALID_URL', '页面地址不属于本活动')
  let url
  try { url = new URL(value) } catch { throw new HttpError(400, 'INVALID_URL', '页面地址不属于本活动') }
  if (!/^https?:\/\//.test(value) || url.origin !== publicOrigin || url.username || url.password) {
    throw new HttpError(400, 'INVALID_URL', '页面地址不属于本活动')
  }
  return url
}

export function parsePointQr(result, publicOrigin, points) {
  try {
    const url = applicationUrl(result, publicOrigin)
    const match = /^\/q\/([A-Za-z0-9_-]{1,32})$/.exec(url.pathname)
    // Reject queries/fragments, encoded or dot-normalized paths and non-point routes.
    const rawPath = /^https?:\/\/[^/?#]+(\/[^?#]*)$/.exec(result)?.[1]
    if (!match || rawPath !== url.pathname || url.search || url.hash) throw new Error('Not a point URL')
    const point = points.find((candidate) => candidate.key === match[1])
    if (!point) throw new Error('Unknown point')
    return point
  } catch {
    throw new HttpError(400, 'INVALID_QR', '这不是有效的活动地点码，请扫描现场地点二维码')
  }
}

export function safeReturnTo(value, publicOrigin) {
  if (value === undefined) return '/'
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s]|%2f|%5c/i.test(value)) {
    throw new HttpError(400, 'INVALID_RETURN', '授权返回地址必须在本活动内')
  }
  const url = applicationUrl(`${publicOrigin}${value}`, publicOrigin)
  if (/^\/(auth|api)(\/|$)/.test(url.pathname)) throw new HttpError(400, 'INVALID_RETURN', '不能返回授权或接口地址')
  return `${url.pathname}${url.search}${url.hash}`
}

export function createWechatClient({ appId, appSecret, publicOrigin, fetchImpl = fetch, now = Date.now }) {
  // Single-process, expiry-bound cache. A shared pending promise coalesces concurrent requests.
  const cache = new Map()
  async function cached(key, load) {
    let entry = cache.get(key)
    if (entry?.value && now() < entry.expiresAt) return entry.value
    if (entry?.pending) return entry.pending
    entry = {}
    cache.set(key, entry)
    const startedAt = now()
    entry.pending = (async () => {
      const { value, expiresIn } = await load()
      if (typeof value !== 'string' || !value || !Number.isFinite(expiresIn) || expiresIn <= 0) throw upstreamError()
      entry.value = value
      entry.expiresAt = startedAt + expiresIn * 1000 - Math.min(60000, expiresIn * 100)
      return value
    })()
    try { return await entry.pending } finally { entry.pending = null }
  }
  async function json(url, options = {}) {
    try {
      const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(8000), redirect: 'error' })
      if (!response.ok) throw upstreamError()
      const data = await response.json()
      if (!data || typeof data !== 'object' || (data.errcode !== undefined && data.errcode !== 0)) throw upstreamError()
      return data
    } catch { throw upstreamError() }
  }
  async function accessToken() {
    return cached('token', async () => {
      // Stable token with no forced refresh avoids invalidating other consumers' tokens.
      const data = await json('https://api.weixin.qq.com/cgi-bin/stable_token', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret: appSecret, force_refresh: false })
      })
      return { value: data.access_token, expiresIn: data.expires_in }
    })
  }
  async function ticket() {
    return cached('ticket', async () => {
      const url = new URL('https://api.weixin.qq.com/cgi-bin/ticket/getticket')
      url.search = new URLSearchParams({ access_token: await accessToken(), type: 'jsapi' }).toString()
      const data = await json(url)
      return { value: data.ticket, expiresIn: data.expires_in }
    })
  }
  return {
    authorizationUrl(state) {
      const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize')
      url.search = new URLSearchParams({ appid: appId, redirect_uri: `${publicOrigin}/auth/callback`, response_type: 'code', scope: 'snsapi_base', state }).toString()
      url.hash = 'wechat_redirect'
      return url.href
    },
    async exchangeCode(code) {
      const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token')
      url.search = new URLSearchParams({ appid: appId, secret: appSecret, code, grant_type: 'authorization_code' }).toString()
      const data = await json(url)
      if (typeof data.openid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.openid)) throw upstreamError()
      return data.openid
    },
    async jsConfig(pageUrl) {
      applicationUrl(pageUrl, publicOrigin)
      // Validate using URL, but sign the original bytes (except #), not a reordered/canonicalized query.
      const url = pageUrl.split('#')[0]
      const jsapiTicket = await ticket()
      const timestamp = Math.floor(now() / 1000)
      const nonceStr = randomBytes(16).toString('hex')
      const signature = createHash('sha1').update(`jsapi_ticket=${jsapiTicket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`).digest('hex')
      return { appId, timestamp, nonceStr, signature, jsApiList: ['scanQRCode'] }
    }
  }
}
