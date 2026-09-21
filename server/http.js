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

export function sendPage(response, { status = 200, title, message, code = '', demo = false, retry = false }) {
  response.set('Cache-Control', 'no-store')
  return response.status(status).type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#f7f1df;color:#183d2b;font-family:system-ui,sans-serif;line-height:1.8}main{max-width:32rem;margin:8vh auto;padding:24px}a{display:inline-block;margin:12px 16px 0 0;color:#245e43}p{white-space:pre-line;overflow-wrap:anywhere}</style></head><body><main data-error-code="${escapeHtml(code)}">${demo ? '<strong>开发演示 · 非真实微信联调</strong>' : ''}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${retry ? '<a href="/auth/wechat">重新授权</a><a href="/?authError=1">返回活动页</a>' : ''}</main></body></html>`)
}
