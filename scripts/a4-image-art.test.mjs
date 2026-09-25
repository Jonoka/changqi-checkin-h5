import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { prepareArt } from './prepare-a4-art.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const dir = 'assets/illustrations/restoration'
const writeJson = (root, name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2) + '\n')
async function fixture(run) {
  await fs.mkdir('tmp', { recursive: true })
  const root = await fs.mkdtemp(path.resolve('tmp', 'a4-image-unit-'))
  try {
    for (const folder of ['assets/reference', `${dir}/masters`, 'web/public/art']) await fs.mkdir(path.join(root, folder), { recursive: true })
    // Synthetic raster bytes are unit fixtures only, never application illustrations or evidence.
    const data = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#607549' } }).png().toBuffer()
    await fs.writeFile(path.join(root, 'assets/reference/test.png'), data)
    await writeJson(root, 'assets/reference/manifest.json', { files: [{ path: 'assets/reference/test.png', width: 96, height: 64, sha256: hash(data) }] })
    const recipe = { version: 1, referenceManifest: 'assets/reference/manifest.json', referenceManifestSha256: hash(await fs.readFile(path.join(root, 'assets/reference/manifest.json'))), crops: [{ id: 'test-crop', reference: 'test.png', crop: { left: 0, top: 0, width: 96, height: 64 }, use: 'UNIT FIXTURE ONLY' }], masters: [] }
    for (const id of ['map', 'p03']) {
      const filename = `${dir}/masters/${id}.png`
      await fs.writeFile(path.join(root, filename), data)
      recipe.masters.push({ id, sourceIds: ['test-crop'], master: { path: filename, sha256: hash(data), width: 96, height: 64, reviewed: true, method: 'UNIT FIXTURE ONLY, not restored artwork' }, output: `web/public/art/${id === 'map' ? 'map' : `point-${id}`}-restored-v1.webp`, maxWidth: 1200, maxBytes: 100000 })
    }
    await writeJson(root, `${dir}/recipe.json`, recipe)
    await run({ root, recipe, save: () => writeJson(root, `${dir}/recipe.json`, recipe) })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}

test('Raster source extraction: all real crops match the approved originals pixel for pixel, with provenance', async () => {
  const recipe = JSON.parse(await fs.readFile(`${dir}/recipe.json`))
  const manifest = JSON.parse(await fs.readFile(`${dir}/source-manifest.json`))
  assert.equal(manifest.sourceSha256, recipe.extractionRecipeSha256, 'Historical extraction manifest remains unchanged when independent PNG masters are imported')
  assert.equal(manifest.files.length, recipe.crops.length)
  for (const file of manifest.files) {
    const crop = recipe.crops.find(entry => file.path.endsWith(`/${entry.id}.png`))
    assert.deepEqual(file.crop, crop.crop)
    assert.equal(file.reference, `assets/reference/${crop.reference}`)
    const original = await fs.readFile(file.reference)
    assert.equal(hash(original), file.referenceSha256)
    const actual = await fs.readFile(file.path)
    assert.equal(hash(actual), file.sha256); assert.equal(actual.length, file.bytes)
    const meta = await sharp(actual).metadata()
    assert.equal(meta.format, 'png'); assert.equal(meta.width, file.crop.width); assert.equal(meta.height, file.crop.height)
    assert.equal(meta.width, file.width); assert.equal(meta.height, file.height)
    assert.equal(hash(await sharp(actual).raw().toBuffer()), hash(await sharp(original).extract(file.crop).raw().toBuffer()))
    assert.ok(file.bytes > 1000 && file.bytes < 2000000)
  }
  assert.ok(manifest.files.reduce((sum, file) => sum + file.bytes, 0) < 4000000)
  assert.doesNotMatch(await fs.readFile('scripts/prepare-a4-art.mjs', 'utf8'), /village-art\.mjs|svgSha256|Buffer\.from\(svg/)
})

test('Missing master registration blocks the entire batch without modifying owned outputs', async () => fixture(async ({ root, recipe, save }) => {
  const result = await prepareArt({ root })
  const manifestPath = path.join(root, 'web/public/art/illustration-manifest.json')
  const before = hash(await fs.readFile(manifestPath))
  recipe.masters.at(-1).master = null; await save()
  await assert.rejects(prepareArt({ root }), /Image master gate blocked: p03/)
  assert.equal(hash(await fs.readFile(manifestPath)), before)
  for (const file of result.files) assert.equal(hash(await fs.readFile(path.join(root, file.path))), file.sha256)
}))

test('Missing master file fails before the first output write', async () => fixture(async ({ root, recipe }) => {
  await fs.unlink(path.join(root, recipe.masters.at(-1).master.path))
  await assert.rejects(prepareArt({ root }), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(path.join(root, 'web/public/art')), [])
}))

test('Actual six imported PNGs and WebP derivatives match the inventory, generation provenance and original dimensions', async () => {
  const recipe = JSON.parse(await fs.readFile(`${dir}/recipe.json`))
  const inventoryBytes = await fs.readFile(recipe.importManifest)
  assert.equal(hash(inventoryBytes), recipe.importManifestSha256)
  const imported = JSON.parse(inventoryBytes)
  const manifest = JSON.parse(await fs.readFile('web/public/art/illustration-manifest.json'))
  assert.equal(manifest.sourceSha256, hash(await fs.readFile(`${dir}/recipe.json`)))
  assert.equal(manifest.importManifestSha256, hash(inventoryBytes))
  assert.equal(imported.files.length, 6); assert.equal(manifest.files.length, 6)
  for (const input of imported.files) {
    const entry = recipe.masters.find(entry => entry.id === input.id)
    const bytes = await fs.readFile(input.path)
    assert.equal(hash(bytes), input.sha256); assert.equal(bytes.length, input.bytes)
    const meta = await sharp(bytes).metadata()
    assert.equal(meta.format, 'png'); assert.equal(meta.width, input.width); assert.equal(meta.height, input.height)
    assert.equal(entry.master.origin, 'conversation-generated-raster')
    assert.equal(entry.master.generationId, input.generationId)
    assert.equal(entry.master.userApproval, input.userApproval)
    const output = manifest.files.find(file => file.path === entry.output)
    assert.equal(output.master.sha256, input.sha256)
    assert.equal(output.master.reviewed, true, 'Technical review, not an additional user approval')
    assert.equal(Object.hasOwn(output, 'sourceIds'), false, 'Old crops are only visual references, not the source pixels')
    const derivative = await sharp(bytes).resize({ width: entry.maxWidth, withoutEnlargement: true }).webp({ quality: 86, effort: 5 }).toBuffer()
    assert.equal(hash(derivative), output.sha256)
    assert.equal(hash(await fs.readFile(output.path)), output.sha256)
    assert.ok(output.width <= input.width && output.height <= input.height)
    assert.ok(Math.abs(output.width / output.height - input.width / input.height) < .001)
    assert.ok(output.bytes <= entry.maxBytes)
  }
  assert.deepEqual(imported.files.filter(file => file.userApproval === 'confirmed-in-conversation').map(file => file.id).sort(), ['map', 'p03'])
})

test('Reviewed raster masters preserve aspect, do not enlarge, and record actual master hashes', async () => fixture(async ({ root, recipe }) => {
  const result = await prepareArt({ root })
  assert.equal(result.files.length, 2)
  for (const file of result.files) {
    assert.equal(file.width, 96); assert.equal(file.height, 64)
    assert.equal(file.master.sha256, recipe.masters.find(entry => entry.output === file.path).master.sha256)
    assert.deepEqual(file.sourceIds, ['test-crop'])
    assert.equal(hash(await fs.readFile(path.join(root, file.path))), file.sha256)
    assert.equal((await sharp(await fs.readFile(path.join(root, file.path))).metadata()).format, 'webp')
    assert.equal(Object.hasOwn(file, 'svgSha256'), false)
  }
  assert.deepEqual(await prepareArt({ root }), result)
}))

test('Unowned output anywhere in the batch prevents all runtime writes', async () => fixture(async ({ root, recipe }) => {
  const last = recipe.masters.at(-1).output
  await fs.writeFile(path.join(root, last), 'unknown manual bytes')
  await assert.rejects(prepareArt({ root }), /Preserve modified\/unowned artwork/)
  assert.equal(await fs.readFile(path.join(root, last), 'utf8'), 'unknown manual bytes')
  await assert.rejects(fs.stat(path.join(root, recipe.masters[0].output)), { code: 'ENOENT' })
  await assert.rejects(fs.stat(path.join(root, 'web/public/art/illustration-manifest.json')), { code: 'ENOENT' })
}))

test('Manual modification of a previously generated image is preserved', async () => fixture(async ({ root, recipe }) => {
  const result = await prepareArt({ root })
  const first = recipe.masters[0].output, last = recipe.masters[1].output
  await fs.writeFile(path.join(root, last), 'manual revision')
  await assert.rejects(prepareArt({ root }), /Preserve modified\/unowned artwork/)
  assert.equal(hash(await fs.readFile(path.join(root, first))), result.files[0].sha256)
  assert.equal(await fs.readFile(path.join(root, last), 'utf8'), 'manual revision')
}))

test('Changed master bytes or dimensions are not silently accepted', async () => fixture(async ({ root, recipe, save }) => {
  recipe.masters[0].master.sha256 = '0'.repeat(64); await save()
  await assert.rejects(prepareArt({ root }), /Master hash changed/)
  recipe.masters[0].master.sha256 = hash(await fs.readFile(path.join(root, recipe.masters[0].master.path)))
  recipe.masters[0].master.width = 192; await save()
  await assert.rejects(prepareArt({ root }), /Master dimensions changed/)
}))

test('Reference hash changes fail before extraction or runtime writes', async () => fixture(async ({ root }) => {
  await fs.writeFile(path.join(root, 'assets/reference/test.png'), 'changed original')
  await assert.rejects(prepareArt({ root, extractSources: true }), /Approved original changed/)
  await assert.rejects(prepareArt({ root }), /Approved original changed/)
}))

test('Generated PNG provenance cannot bypass a changed import inventory or claim extra approval', async () => fixture(async ({ root, recipe, save }) => {
  for (const entry of recipe.masters) Object.assign(entry.master, { origin: 'conversation-generated-raster', generationId: `test-${entry.id}`, userApproval: 'integration-preview-only' })
  recipe.importManifest = `${dir}/masters-import-manifest.json`
  await writeJson(root, recipe.importManifest, { files: recipe.masters.map(entry => ({ id: entry.id, ...entry.master })) })
  recipe.importManifestSha256 = hash(await fs.readFile(path.join(root, recipe.importManifest))); await save()
  await prepareArt({ root })
  recipe.masters[0].master.userApproval = 'confirmed-in-conversation'; await save()
  await assert.rejects(prepareArt({ root }), /import inventory and approval boundary/)
  recipe.masters[0].master.userApproval = 'integration-preview-only'; recipe.importManifestSha256 = '0'.repeat(64); await save()
  await assert.rejects(prepareArt({ root }), /Import manifest hash changed/)
}))

test('A disguised SVG master cannot enter the raster pipeline', async () => fixture(async ({ root, recipe, save }) => {
  const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64"/></svg>')
  await fs.writeFile(path.join(root, recipe.masters[0].master.path), fake)
  recipe.masters[0].master.sha256 = hash(fake); await save()
  await assert.rejects(prepareArt({ root }), /single PNG\/WebP image master/)
}))

test('An unreviewed master cannot be promoted merely because bytes exist', async () => fixture(async ({ root, recipe, save }) => {
  recipe.masters[0].master.reviewed = false; await save()
  await assert.rejects(prepareArt({ root }), /Image master gate blocked: map/)
}))

test('Source extraction protects unexpected manual crops and unrelated files', async () => fixture(async ({ root }) => {
  const result = await prepareArt({ root, extractSources: true })
  const target = path.join(root, result.files[0].path)
  await fs.writeFile(target, 'manual crop')
  await fs.writeFile(path.join(root, `${dir}/sources/keep.png`), 'unrelated source')
  await assert.rejects(prepareArt({ root, extractSources: true }), /Preserve modified\/unowned artwork/)
  assert.equal(await fs.readFile(target, 'utf8'), 'manual crop')
  assert.equal(await fs.readFile(path.join(root, `${dir}/sources/keep.png`), 'utf8'), 'unrelated source')
}))

test('Unsafe paths and oversized budgets are rejected without writing artifacts', async () => fixture(async ({ root, recipe, save }) => {
  recipe.masters[0].output = 'web/public/art/../../outside.webp'; await save()
  await assert.rejects(prepareArt({ root }), /versioned restored image filename/)
  recipe.masters[0].output = 'web/public/art/map-restored-v1.webp'
  recipe.masters[0].maxBytes = 10000000; await save()
  await assert.rejects(prepareArt({ root }), /Invalid derivative budget/)
}))
