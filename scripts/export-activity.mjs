import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadActivityConfig } from '../server/config.js'
import { createDatabasePool, databaseSettings, hasDatabaseSettings } from '../server/db.js'
import { exportActivity } from '../server/activity-export.js'

export const HELP = `一次性只读活动资料导出（不自动加载 .env、不停止活动、不迁移数据库）
用法：npm run export:activity -- --out "<私有新批次绝对目录>" [--scope participants|completed|claimed] [--dry-run]
默认 scope: participants。输出父目录须已存在且为负责人控制的私有目录；已有批次拒绝覆盖。
显式环境：DB_HOST、DB_PORT、DB_NAME、DB_USER、DB_PASSWORD、UPLOAD_DIR（绝对路径）。
可选：STATS_EXCLUDE_CQ_FILE（私有绝对路径，负责人确认的规范CQ JSON数组；默认空）。
建议先 --dry-run，检查人数/记录/可读性/空间，再使用同一个尚不存在的批次目录正式执行。
三个统计CSV始终为全活动总览；scope仅筛选游客进度和当前照片。
退出码：0完整成功；2部分照片/业务异常；1致命失败或参数错误。
照片逐张流式复制且版本变化最多重试3次；不能保证整包同一时刻。
正式收尾由负责人另行授权停止写入并等在途请求完成，脚本不执行停止或部署。
资料仅用于本活动内部记录/核查；下载至私有电脑后用系统工具压缩，不公开共享。`

export function parseArgs(args) {
  const options = { scope: 'participants', dryRun: false }, seen = new Set()
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (seen.has(flag)) throw new Error('重复参数')
    seen.add(flag)
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--out' || flag === '--scope') {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error('参数缺少值')
      options[flag === '--out' ? 'out' : 'scope'] = value
    } else throw new Error('未知参数；使用 --help')
  }
  if (!options.out || !path.isAbsolute(options.out)) throw new Error('必须指定新批次绝对目录 --out')
  if (!['participants', 'completed', 'claimed'].includes(options.scope)) throw new Error('不支持的scope')
  return options
}
export async function main(args = process.argv.slice(2), env = process.env) {
  let pool
  const controller = new AbortController()
  const stop = () => controller.abort()
  try {
    const options = parseArgs(args)
    if (options.help) { console.log(HELP); return 0 }
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'UPLOAD_DIR']) {
      if (!Object.hasOwn(env, key) || (key !== 'DB_PASSWORD' && !env[key])) throw new Error(`缺少显式环境变量 ${key}`)
    }
    const settings = databaseSettings(env)
    if (!hasDatabaseSettings(settings) || settings.port > 65535 || !path.isAbsolute(env.UPLOAD_DIR)) throw new Error('数据库或照片目录配置不完整')
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
    pool = createDatabasePool({ ...settings, connectionLimit: 1, connectTimeout: 10000 })
    const result = await exportActivity({ ...options, pool, activityConfig: loadActivityConfig(), uploadDir: env.UPLOAD_DIR,
      exclusionFile: env.STATS_EXCLUDE_CQ_FILE ?? '', signal: controller.signal })
    console.log(JSON.stringify(result, null, 2))
    return result.exitCode
  } catch (error) {
    // Never echo driver messages, SQL values, environment secrets or source paths.
    const code = /^[A-Z_]{2,64}$/.test(error?.code || '') ? error.code : controller.signal.aborted ? 'ABORTED' : 'EXPORT_FAILED'
    console.error(`导出未完成：${code}。请核对 --help、显式环境、输出权限及磁盘；不会修改业务数据。`)
    return 1
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
    if (pool) await pool.end()
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main()
