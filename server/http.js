export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function sendApiError(response, status, code, message) {
  return response.status(status).json({ ok: false, error: { code, message } })
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

// Standalone pages keep the same visual vocabulary even before the frontend is built.
// content is composed only by server templates; escape every dynamic value at the call site.
export function pageShell({ title, content, code = '', demo = false, illustration = false }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#22593f"><title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#e5ebdc;color:#213f32;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.8;min-width:280px}main{max-width:480px;min-height:100vh;margin:0 auto;padding:max(24px,env(safe-area-inset-top)) 22px max(32px,env(safe-area-inset-bottom));background:#f8f4e7}h1{font-family:"STKaiti","KaiTi",serif;font-size:30px;line-height:1.45;margin:24px 0 16px;color:#22593f}p{white-space:pre-line;overflow-wrap:anywhere;font-size:14px}.brand{display:flex;align-items:center;gap:10px;color:#22593f;font-weight:bold;font-size:12px;letter-spacing:.08em}.seal{display:inline-grid;place-items:center;width:28px;height:31px;border:1px solid #22593f;border-radius:5px 5px 9px 9px;font-family:serif;font-size:20px}.art{display:block;width:calc(100% + 44px);height:155px;object-fit:cover;margin:10px -22px;mask-image:linear-gradient(transparent,#000 15%,#000 75%,transparent)}.paper{padding:20px;border:1px solid #dce0ca;border-radius:18px;background:#fffdf6;margin:20px 0}.eyebrow{color:#826721;font-size:11px;letter-spacing:.1em}.notice{padding:12px 14px;background:#f4ead0;border-radius:12px;font-size:13px;color:#695324}.guide-steps{padding-left:24px}.guide-steps li{padding:7px 0;font-size:14px}.guide-steps li::marker{color:#22593f;font-weight:bold}a,button{display:inline-block;min-height:44px;padding:10px 18px;margin:8px 0;border:1px solid #22593f;border-radius:24px;background:#22593f;color:white;font:inherit;text-decoration:none;cursor:pointer}a+ a{margin-left:8px;background:transparent;color:#22593f}button{width:100%}a:focus-visible,button:focus-visible{outline:3px solid #b7862e;outline-offset:4px}[role=alert]{color:#8b3c30}.stats-number{display:block;font-family:Georgia,serif;font-size:68px;line-height:1.15;color:#22593f;overflow-wrap:anywhere}time{font-size:13px;overflow-wrap:anywhere}.footnote{padding-top:20px;border-top:1px solid #dce0ca;font-size:11px;color:#637364}.page-footer{text-align:center;margin-top:32px;color:#637364;font-size:11px}@media(min-width:600px){body{padding:28px 0}main{border-radius:22px;min-height:calc(100vh - 56px)}}
</style></head><body><main data-error-code="${escapeHtml(code)}"><div class="brand"><span class="seal" aria-hidden="true">岐</span>长岐漫游手记</div>${demo ? '<p class="notice">开发演示 · 非真实微信或现场派发结果</p>' : ''}<h1>${escapeHtml(title)}</h1>${illustration ? '<img class="art" src="/art/lane.webp" alt="" aria-hidden="true" width="640" height="265">' : ''}${content}<footer class="page-footer">一程慢游，一份长岐记忆</footer></main></body></html>`
}

export function sendPage(response, { status = 200, title, message, code = '', demo = false, retry = false, guide = false }) {
  response.set('Cache-Control', 'no-store')
  const content = `<section class="paper"><p${status >= 400 ? ' role="alert"' : ''}>${escapeHtml(message)}</p>${guide ? '<ol class="guide-steps"><li>在微信中打开公众号</li><li>从公众号底部菜单进入活动</li><li>使用活动页面内的扫一扫，再上传现场照片</li></ol>' : ''}</section>${retry ? '<a href="/auth/wechat">重新授权</a><a href="/?authError=1">返回活动页</a>' : ''}${guide ? '<p class="footnote">此页仅作公众号入口引导，不读取关注状态、不记录打卡。插画为概念示意。</p>' : ''}`
  return response.status(status).type('html').send(pageShell({ title, content, code, demo, illustration: guide }))
}
