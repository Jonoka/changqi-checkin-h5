// A response loss is not proof that the server failed to write. Never submit again automatically.
export async function claimWithRecovery({ submit, readState }) {
  let failure
  try {
    const state = await submit()
    if (state?.claimedAt) return { state, recovered: false }
    failure = new Error('服务未确认领取，请核对最新状态')
  } catch (error) { failure = error }
  let state
  try { state = await readState() } catch (error) {
    if (error.code === 'NEED_LOGIN') throw error
    const unknown = new Error('暂时无法确认领取结果，请核对状态，不要重复派发礼品')
    unknown.code = 'VERIFY_REQUIRED'
    throw unknown
  }
  if (state?.claimedAt) return { state, recovered: true }
  failure.currentState = state
  throw failure
}
