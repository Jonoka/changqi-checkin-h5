export function csvCell(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid CSV count')
    return String(value)
  }
  let text = value == null ? '' : String(value)
  // Quoting alone does NOT prevent spreadsheet formulas. Include leading whitespace and full-width operators.
  if (/^[\s\ufeff]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export const csv = rows => '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'

export const metricLabels = {
  identified: '已识别用户数', participants: '参与人数', completed: '完成人数', claimed: '已标记领取人数',
  completedUnclaimed: '完成未领取人数', photoRecords: '有效照片记录数', claimedIncomplete: '已领取但记录不全人数'
}
export function metadataRows(report) {
  return [['活动', report.activityName], ['口径版本', report.ruleVersion], ['查询时间', report.queriedAt], ['时区', report.timezone],
    ['必达地点数', report.total], ['排除名单启用', report.exclusion.enabled ? '是' : '否'], ['匹配排除人数', report.exclusion.matchedUsers],
    ['人数口径', '当前配置地点；微信身份数，非独立核验的现场自然人数；缺图不撤销历史打卡'], []]
}
export function reportCsv(report, type) {
  let rows
  if (type === 'summary') rows = [['指标', '数量'], ...Object.entries(metricLabels).map(([key, name]) => [name, report.summary[key]])]
  else if (type === 'points') rows = [['地点key', '地点名称', '打卡人数'], ...report.points.map(point => [point.key, point.name, point.users])]
  else if (type === 'daily') rows = [['北京时间日期', '首次参与人数', '推导首次完成人数', '首次标记领取人数'], ...report.daily.map(day => [day.date, day.participants, day.completed, day.claimed])]
  else throw new Error('Unknown fixed report')
  return csv([...metadataRows(report), ...rows])
}
export const progressCsv = (report, users) => csv([...metadataRows(report), ['游客编号', '已完成数', '必达数', '首次参与时间', '推导首次完成时间', '是否领取', '首次领取时间'],
  ...users.map(user => [user.cq, user.completedCount, user.total, user.firstParticipationAt, user.completedAt, user.claimedAt ? '是' : '否', user.claimedAt])])
export const photosCsv = (report, records) => csv([...metadataRows(report), ['游客编号', '地点key', '地点名称', '首次打卡保存时间', '快照版本', '实际导出版本', '相对路径', '字节数', 'SHA-256', '导出时间', '结果', '尝试次数'],
  ...records.map(row => [row.cq, row.pointKey, row.pointName, row.createdAt, row.snapshotRevision, row.actualRevision, row.relativePath, row.bytes, row.sha256, row.exportedAt, row.result, row.attempts])])
export const anomaliesCsv = (report, anomalies) => csv([...metadataRows(report), ['游客编号', '地点key', '异常代码', '说明'],
  ...anomalies.map(row => [row.cq, row.pointKey, row.code, row.message])])
