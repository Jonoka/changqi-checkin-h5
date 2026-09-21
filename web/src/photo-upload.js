// A failed/late upload response is not proof that the server did not save it.
// This helper never blindly resubmits a file and never synthesizes completed progress.
export async function uploadWithRecovery({ pointKey, file, upload, readState }) {
  try {
    const state = await upload(pointKey, file)
    if (!state?.completedKeys?.includes(pointKey)) throw new Error('保存结果不完整，请核对本人状态')
    return { state, recovered: false }
  } catch (cause) {
    let state
    try { state = await readState() } catch (verification) {
      if (verification.code === 'NEED_LOGIN') throw verification
      const error = new Error('暂时无法确认是否保存，请先核对保存结果，不要重复提交')
      error.code = 'VERIFY_REQUIRED'
      throw error
    }
    if (state.completedKeys.includes(pointKey)) return { state, recovered: true }
    cause.currentState = state
    throw cause
  }
}
