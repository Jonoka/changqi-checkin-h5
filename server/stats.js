import basicAuth from 'express-basic-auth'
import { escapeHtml, sendPage, pageShell } from './http.js'
import { readActivityReport } from './activity-reports.js'
import { reportCsv, metricLabels } from './report-csv.js'

export function mountStats(app, { pool, runtime, activityConfig }) {
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
  const read = () => readActivityReport(pool, activityConfig, { exclusionFile: runtime.statsExclusionFile ?? '' })
  app.get('/stats', async (_request, response) => {
    try { response.type('html').send(page(await read(), runtime.mockEnabled)) }
    catch {
      console.error('Statistics query/configuration failed')
      sendPage(response, { status: 503, title: '活动只读统计', message: '暂时无法读取，请刷新重试；若持续失败，请负责人核对数据库及统计配置。', demo: runtime.mockEnabled })
    }
  })
  // Fixed routes after the SAME authentication middleware. No user-selected SQL or disk path.
  for (const type of ['summary', 'points', 'daily']) {
    app.get(`/stats/export/${type}.csv`, async (_request, response) => {
      try {
        const body = reportCsv(await read(), type)
        response.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${type}.csv"` }).send(body)
      } catch {
        console.error('Statistics CSV query/configuration failed')
        response.status(503).type('text').send('报表生成失败，请稍后重试并核对统计配置。')
      }
    })
  }
  app.use('/stats', (_request, response) => sendPage(response, { status: 404, title: '页面不存在', message: '请访问 /stats 查询人数。' }))
}

function page(report, demo) {
  const e = escapeHtml
  const cards = ['participants', 'completed', 'claimed', 'completedUnclaimed'].map(key => `<section class="paper metric"><p>${metricLabels[key]}</p><strong class="stats-number" ${key === 'claimed' ? 'data-stats-count' : `data-metric="${key}"`}>${report.summary[key]}</strong></section>`).join('')
  const table = (caption, headings, rows) => `<section class="paper"><h2>${caption}</h2><div class="table-scroll"><table><thead><tr>${headings.map(item => `<th scope="col">${e(item)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(item => `<td>${e(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length ? '' : '<p>查询成功，暂无事件记录。</p>'}</section>`
  const content = `<style>main{max-width:1000px}.stats-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.metric{margin:0;padding:16px}.metric p{margin:0 0 10px}.stats-number{font-size:46px}.stats-meta{color:#637364}h2{font-size:19px}table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}th,td{padding:9px 6px;border-bottom:1px solid #dce0ca;overflow-wrap:anywhere}.table-scroll{overflow-x:auto}nav{display:flex;gap:8px;flex-wrap:wrap}nav a{margin:0!important;font-size:13px}.stats-refresh{max-width:240px}@media(min-width:760px){.stats-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}</style>
    <p class="eyebrow">${e(report.activityName)} · 只读查询</p>
    <div class="stats-grid">${cards}</div>
    <section class="paper"><p>已识别用户：<strong>${report.summary.identified}</strong>　有效照片记录：<strong>${report.summary.photoRecords}</strong>　必达地点：${report.total}</p>
    <p class="stats-meta">查询时间：<time>${e(report.queriedAt)}</time>（北京时间）<br>规则：${e(report.ruleVersion)}<br>排除名单：${report.exclusion.enabled ? '已启用' : '未启用'}；匹配排除 ${report.exclusion.matchedUsers} 个身份。</p>
    ${report.summary.claimedIncomplete ? `<p role="alert">发现 ${report.summary.claimedIncomplete} 个已领取但当前记录不完整的身份；仅提示异常，没有修改数据。</p>` : ''}
    <form action="/stats" method="get" class="stats-refresh"><button type="submit">手动刷新统计</button></form>
    <nav aria-label="下载聚合报表"><a href="/stats/export/summary.csv">统计汇总 CSV</a><a href="/stats/export/points.csv">地点统计 CSV</a><a href="/stats/export/daily.csv">每日统计 CSV</a></nav></section>
    ${table('各地点打卡人数', ['地点', '人数'], report.points.map(point => [`${point.key} · ${point.name}`, point.users]))}
    ${table('每日首次事件 · 北京时间', ['日期', '首次参与', '首次完成', '首次领取'], report.daily.map(day => [day.date, day.participants, day.completed, day.claimed]))}
    <p class="footnote">人数指微信身份数，不是点击次数，也不是独立核验的现场自然人数或实物派发量。仅当前配置地点计入参与/完成；缺图不撤销历史打卡。每日完成由全部有效记录推导，不是当日上传数量。下载各自使用请求时的快照，期间新增数据可能使结果不同。照片和逐游客资料仅通过经授权的命令行工具导出，不在网页提供。</p>`
  return pageShell({ title: '活动只读统计', content, demo })
}
