import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

// Small markup/style contracts; these do not claim WeChat, SQL or browser integration coverage.
const panel = await fs.readFile(new URL('../web/src/PhotoPanel.vue', import.meta.url), 'utf8')
const css = await fs.readFile(new URL('../web/src/style.css', import.meta.url), 'utf8')

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(css)
  assert.ok(found, `Missing rule: ${selector}`)
  return found[1]
}

test('UI polish: unscanned panel does not repeat the parent point hint', () => {
  const branch = /<template v-else-if="!scanned">([\s\S]*?)<\/template>/.exec(panel)?.[1]
  assert.ok(branch)
  assert.equal((branch.match(/<slot name="scan"\s*\/>/g) || []).length, 1)
  assert.equal(branch.split('<slot')[0].trim(), '', 'Scanner follows the single parent hint without another paragraph')
  assert.doesNotMatch(branch, /请先使用微信扫一扫或页面内扫一扫打开该地点码/)
  assert.match(branch, /<details class="upload-help">/, 'Optional recovery help remains available')
  assert.match(panel, /<p v-if="message"[\s\S]*?role="status">\{\{ message \}\}/, 'Real upload feedback is not hidden')
})

test('UI polish: reselect has no decorative border but remains touch sized', () => {
  const reselect = rule('.has-selection .upload-label')
  assert.match(reselect, /border:\s*0\s*;/)
  assert.match(reselect, /min-height:\s*44px\s*;/)
  assert.match(reselect, /background:\s*transparent\s*;/)
  assert.match(rule('.upload-label'), /border:\s*1px dashed/, 'Initial upload card retains its affordance')
})

test('UI polish: picker focus is keyboard-visible, not an unconditional pointer outline', () => {
  assert.doesNotMatch(css, /\.photo-picker:focus-within\s+\.upload-label\s*\{/)
  const focus = rule('.photo-input:focus-visible + .upload-label')
  assert.match(focus, /outline:\s*3px solid/)
  assert.match(focus, /outline-offset:\s*3px/)
})

test('UI polish: native selection and unknown-result locks are retained', () => {
  assert.match(panel, /<input[^>]*:id="`photo-\$\{point\.key\}`"[^>]*type="file"[^>]*:disabled="busy \|\| phase === 'unknown'"[^>]*@change="choose"/)
  assert.match(panel, /<label class="upload-label" :for="`photo-\$\{point\.key\}`"/)
  assert.match(panel, /if \(!chosen\) return/, 'Cancelling a reselect keeps the previous selection')
  assert.match(panel, /if \(busy\.value \|\| phase\.value === 'unknown'\) return/)
  assert.match(panel, /已完成地点不替换照片/, 'Saved photos remain immutable')
})
