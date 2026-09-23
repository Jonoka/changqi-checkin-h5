import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import dotenv from 'dotenv'
import QRCode from 'qrcode'
import { loadActivityConfig, validateActivityConfig } from '../server/config.js'
import { parsePointQr } from '../server/wechat.js'

export const FINAL_ORIGIN = 'https://cq.fsxinhuo.cn'
export const PRINT_WARNING = '正式地址已定，待真机/纸样试扫，不可直接批量印刷。'
const TEST_WARNING = '测试，不可正式印刷。'
// Printing assertions only, not an alternative activity config or a business N constant.
const confirmedBindings = new Map([
  ['p01', '葫芦娃'], ['p02', '卢氏大宗祠'], ['p03', '沉香古井'], ['p04', '苞榕'], ['p05', '文笔山顶']
])
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const qrOptions = { errorCorrectionLevel: 'M', margin: 4, scale: 24, color: { dark: '#000000ff', light: '#ffffffff' } }
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const html = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const csv = (value) => `"${String(value).replaceAll('"', '""')}"`

export function pointQrPlan(activity, origin, { test = false } = {}) {
  validateActivityConfig(activity)
  if (typeof origin !== 'string' || !origin || /[\s\\]/.test(origin)) throw new Error('Explicit origin or PUBLIC_ORIGIN is required; no development fallback')
  let parsed
  try { parsed = new URL(origin) } catch { throw new Error('Invalid origin') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) {
    throw new Error('Origin must be canonical http(s)://host[:port], without path, trailing slash, credentials, query or hash')
  }
  if (test ? origin === FINAL_ORIGIN : origin !== FINAL_ORIGIN) throw new Error(test ? 'Final origin cannot be labelled as a test origin' : `Production paper proof requires exactly ${FINAL_ORIGIN}; use --test only for separate test output`)
  if (!test && (activity.points.length !== confirmedBindings.size || activity.points.some(point => confirmedBindings.get(point.key) !== point.name))) {
    throw new Error('Production key/name bindings differ from the confirmed five locations; do not silently reassign printed keys')
  }
  return [...activity.points].sort((a, b) => a.key.localeCompare(b.key, 'en')).map((point) => {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(point.key) || /[<>:"/\\|?*\u0000-\u001f]/.test(point.name) || point.name !== point.name.trim() || point.name.endsWith('.')) {
      throw new Error('Unsafe point key/name for QR filenames')
    }
    const url = `${origin}/q/${point.key}`
    const accepted = parsePointQr(url, origin, activity.points)
    if (accepted.key !== point.key || accepted.name !== point.name) throw new Error('Existing server QR parser returned the wrong point')
    const base = `${point.key}-${point.name}`
    return { key: point.key, name: point.name, url, png: `${base}.png`, svg: `${base}.svg` }
  })
}

export function parseQrArguments(args, env = process.env) {
  const options = { origin: env.PUBLIC_ORIGIN, test: false }
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!['--origin', '--out', '--test'].includes(flag) || seen.has(flag)) throw new Error('Usage: npm run qr:points -- --origin ORIGIN --out NEW_DIRECTORY [--test]')
    seen.add(flag)
    if (flag === '--test') options.test = true
    else {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
      options[flag === '--origin' ? 'origin' : 'out'] = value
    }
  }
  if (!options.out || options.out !== options.out.trim()) throw new Error('Choose an explicit new --out directory (test and production must be separate)')
  return options
}

function printPage(points, warning, accountName) {
  const sign = `使用微信扫一扫现场地点二维码，打开页面并上传现场照片。也可从‘${accountName}’公众号进入活动，使用页面内扫一扫。`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>长岐村地点二维码 · 待验证纸样</title>
<style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:24px;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#000;background:#fff}main{max-width:920px;margin:auto}h1{font-size:24px;line-height:1.3}.warning{font-weight:700}.points{display:flex;flex-wrap:wrap;gap:16px}article{width:85mm;padding:5mm;border:1px solid #bbb;break-inside:avoid;page-break-inside:avoid}h2{font-size:20px;margin:0 0 2mm}.qr{display:block;width:50mm;height:50mm;margin:2mm auto;image-rendering:pixelated}.url{font:11px/1.5 monospace;overflow-wrap:anywhere;margin:2mm 0}.sign{font-size:12px}.card-warning{font-size:11px;font-weight:700}nav a{margin-right:12px}small{display:block}a{color:inherit}@media print{body{margin:0;font-size:11px}h1{font-size:18px}nav,.screen-only{display:none}.points{display:block}article{display:inline-block;vertical-align:top;margin:0 4mm 4mm 0}.qr{width:50mm;height:50mm}a{text-decoration:none}}
</style></head><body><main><h1>长岐村漫游打卡 · 地点二维码</h1><p class="warning">${html(warning)}</p><p>仅作约 5 cm 试印起点，打印选择实际大小 / 100%，关闭页眉页脚；用尺实测码图含白边约 50 mm。地名、URL 和说明均在码外，四模块白边不能裁剪。</p><p class="screen-only">本页离线可打开。打印尺寸不是扫码距离保证，须使用现场材质、光线及预计距离逐张试扫。</p><div class="points">${points.map(point => `<article><h2>${html(point.key)} · ${html(point.name)}</h2><img class="qr" src="${html(point.svg)}" alt="${html(point.name)}地点二维码"><p class="url">${html(point.url)}</p><p class="sign">${html(sign)}</p><p class="card-warning">${html(warning)}</p><nav><a href="${html(point.png)}">PNG</a><a href="${html(point.svg)}">SVG</a></nav></article>`).join('\n')}</div><small>自动解码不能代替微信真机与真实纸样。地点码不等于个人领取码；微信直接扫码自动识别后进入对应地点，照片保存成功才算打卡。微信外提示使用微信打开。</small></main></body></html>\n`
}

export async function generatePointQrs({ origin, out, test = false, activity = loadActivityConfig() }) {
  const points = pointQrPlan(activity, origin, { test })
  if (typeof out !== 'string' || !out.trim()) throw new Error('An explicit new output directory is required')
  const output = path.resolve(out)
  const warning = test ? TEST_WARNING : PRINT_WARNING
  const contents = new Map()
  const rows = []
  for (const point of points) {
    const png = await QRCode.toBuffer(point.url, { ...qrOptions, type: 'png' })
    const svg = Buffer.from(await QRCode.toString(point.url, { ...qrOptions, type: 'svg' }))
    const modules = QRCode.create(point.url, qrOptions).modules.size
    contents.set(point.png, png); contents.set(point.svg, svg)
    rows.push({ ...point, modules, pngPixels: (modules + 2 * qrOptions.margin) * qrOptions.scale, sha256: { png: sha256(png), svg: sha256(svg) } })
  }
  let sourceCommit = null, sourceWorktreeDirty = null
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    sourceWorktreeDirty = Boolean(execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
  } catch { /* A copied source bundle can still generate a proof; do not invent a commit. */ }
  const sourceFilesSha256 = {}
  for (const filename of ['config/activity.json', 'server/wechat.js', 'server/config.js', 'scripts/generate-point-qrs.mjs', 'package-lock.json']) {
    sourceFilesSha256[filename] = sha256(await fs.readFile(path.join(root, filename)))
  }
  const command = `npm run qr:points -- --origin ${origin} --out ${JSON.stringify(out)}${test ? ' --test' : ''}`
  const manifest = {
    schemaVersion: 1, mode: test ? 'test' : 'production-address-paper-proof', origin,
    notice: warning, generatedAt: new Date().toISOString(), command,
    sourceCommit, sourceWorktreeDirty, sourceFilesSha256,
    activityConfigSha256: sha256(JSON.stringify(activity)),
    rendering: { library: 'qrcode', errorCorrectionLevel: 'M', margin: 4, scale: 24, dark: '#000000', light: '#ffffff', proofSizeMmIncludingQuietZone: 50 },
    verification: { addressFinalized: !test, generated: true, automaticDecode: 'not-verified-at-generation; see a separate decode report if supplied', wechatIos: 'not-verified', wechatAndroid: 'not-verified', realPaper: 'not-verified', bulkPrintApproved: false },
    points: rows
  }
  contents.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
  contents.set('地点二维码清单.csv', '\ufeff' + [['key', '中文地点名', '完整URL', 'PNG文件名', 'SVG文件名'], ...rows.map(p => [p.key, p.name, p.url, p.png, p.svg])].map(row => row.map(csv).join(',')).join('\r\n') + '\r\n')
  contents.set('index.html', printPage(rows, warning, activity.wechat.officialAccountName))
  contents.set('印刷说明-待验证.txt', `${warning}\n\n${command}\n\n黑码白底，M 纠错，四模块白边，PNG scale=24（整数模块，不再模糊缩放）。优先把 SVG 按含白边约 5 cm 放入试印牌面；5 cm 仅为起点，不保证任意距离可扫。不要加 Logo、装饰、渐变、阴影，不要反色或裁去白边。\n\n打开 index.html 可离线核对并打印：实际大小/100%，关闭页眉页脚，用尺核对 50 mm；检查地名、key 与清单逐一相符。\n\n现场牌面文字：使用微信扫一扫现场地点二维码，打开页面并上传现场照片。也可从‘${activity.wechat.officialAccountName}’公众号进入活动，使用页面内扫一扫。\n不要写“扫码即完成”。原五个二维码载荷、key、路径和码图不变；保留旧纸样包，只更正外围说明，不要求重印码图。\n\n试扫顺序（由获授权测试身份在可用联调环境执行）：\n1. iOS 微信和 Android 微信分别直接扫一扫五张地点码；应自动识别当前用户，进入对应名称/插画后直接上传，不要求关注、返回菜单或二次扫码。\n2. 从公众号原活动入口进入后，再从微信扫一扫进入；验证同用户恢复旧照片/进度/领取码。验证重进、会话过期、同设备切换账号、已关注与未关注用户；权限不足如实待验，不改成强制关注。\n3. 两类手机从 H5 页内扫一扫扫同一张纸码，也应进入对应地点；两种扫码都不增进度，现场照片保存成功才完成。\n4. 验证取消、相机权限拒绝、返回再扫、相册选择与重选；全部完成走 /#claim，另一手机扫码走 /r/:claimCode。\n5. 在授权联调库验证游客/派发两路领取、重复不累加；未授权不得在正式库写入。\n6. 用真实约 5 cm 纸样逐张检查材质、光线、使用距离、白边与标签配对，不仅扫屏幕。\n\n仅当五处内容核对、iOS/Android 两类扫码入口及真实纸样均通过，再由用户批准批量印刷。自动 PNG/SVG 解码不等于微信或纸样试扫通过；生成本身不验证 DNS、HTTPS、部署版本或公众号权限。\n\n印刷后保持域名、/q/路径和 key/地点绑定不变；改顺序或插画不重编 key。运行中的个人领取码不在此包中。\n`)
  // Reserve a NEW directory before any file write. Never overwrite an old proof or mix test/production files.
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.mkdir(output)
  for (const [filename, bytes] of contents) await fs.writeFile(path.join(output, filename), bytes, { flag: 'wx' })
  return { output, manifest }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    dotenv.config({ quiet: true }) // Does not override an explicit environment variable or write .env.
    const result = await generatePointQrs(parseQrArguments(process.argv.slice(2)))
    console.log(`${result.manifest.notice}\nGenerated ${result.manifest.points.length} PNG + SVG pairs: ${result.output}\nAutomatic decode is NOT asserted by generation. Open index.html and read the print instructions.`)
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Output already exists: choose a new --out directory; nothing overwritten.' : `QR export failed: ${error.message}`)
    process.exitCode = 1
  }
}
