export async function api(path, options = {}) {
  const { timeoutMs = 12000, ...requestOptions } = options
  let response
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...requestOptions, signal: requestOptions.signal || AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new Error('网络暂时不可用，请检查连接后重试')
  }
  let payload
  try { payload = await response.json() } catch { throw new Error('服务返回异常，请刷新重试') }
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(payload?.error?.message || '请求失败，请稍后重试')
    error.code = payload?.error?.code
    error.status = response.status
    throw error
  }
  return payload.data
}

export function post(path, body) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
