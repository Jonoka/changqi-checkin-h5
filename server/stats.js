import basicAuth from 'express-basic-auth'
import { escapeHtml, sendPage, pageShell } from './http.js'
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
  const content = `<section class="paper"><p class="eyebrow">本次活动 · 只读查询</p>${queriedAt ? `<strong class="stats-number" data-stats-count>${escapeHtml(value)}</strong><p>查询时间：<time>${escapeHtml(queriedAt)}</time></p>` : `<p role="alert">${escapeHtml(value)}</p>`}<form action="/stats" method="get"><button type="submit">刷新人数</button></form></section><p class="footnote">统计已标记领取的身份数，不是点击次数，也不代表独立核验的实物派发量。</p>`
  return pageShell({ title: '已标记领取人数', content, demo })
}
