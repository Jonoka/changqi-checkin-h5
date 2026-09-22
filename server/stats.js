import basicAuth from 'express-basic-auth'
import { escapeHtml, sendPage } from './http.js'
import { chinaTime } from './identity.js'

export function mountStats(app, { pool, runtime }) {
  app.use('/stats', (_request, response, next) => {
    response.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
    next()
  })
  if (!runtime.statsUser || !runtime.statsPassword) {
    app.use('/stats', (_request, response) => sendPage(response, { status: 503, title: '人数查询未启用', message: '请由负责人先配置只读查询凭据。', demo: runtime.mockEnabled }))
    return
  }
  app.use('/stats', basicAuth({
    users: { [runtime.statsUser]: runtime.statsPassword },
    challenge: true, realm: 'changqi-stats', unauthorizedResponse: '需要人数查询凭据'
  }))
  app.get('/stats', async (_request, response) => {
    let count, queriedAt
    try {
      if (!pool) throw new Error('No database')
      const [rows] = await pool.query('SELECT COUNT(*) AS claimed_user_count FROM users WHERE claimed_at IS NOT NULL')
      count = String(rows[0].claimed_user_count)
      if (!/^\d+$/.test(count)) throw new Error('Invalid count')
      queriedAt = chinaTime(new Date())
    } catch {
      console.error('Statistics query failed')
      return response.status(503).type('html').send(page('暂时无法读取，请刷新重试', null, runtime.mockEnabled))
    }
    response.type('html').send(page(count, queriedAt, runtime.mockEnabled))
  })
  app.use('/stats', (_request, response) => sendPage(response, { status: 404, title: '页面不存在', message: '请访问 /stats 查询人数。' }))
}

function page(value, queriedAt, demo) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>已标记领取人数</title><style>body{font-family:system-ui,sans-serif;background:#f7f1df;color:#183d2b;margin:0}main{max-width:32rem;margin:8vh auto;padding:24px;line-height:1.8}strong{font-size:2rem}button{padding:12px;font:inherit}</style></head><body><main>${demo ? '<p>开发演示 · 测试记录，非现场派发结果</p>' : ''}<h1>已标记领取人数</h1>${queriedAt ? `<strong data-stats-count>${escapeHtml(value)}</strong><p>查询时间：<time>${escapeHtml(queriedAt)}</time></p>` : `<p role="alert">${escapeHtml(value)}</p>`}<form action="/stats" method="get"><button type="submit">刷新人数</button></form><p>统计已标记领取的身份数，不是点击次数，也不代表独立核验的实物派发量。</p></main></body></html>`
}
