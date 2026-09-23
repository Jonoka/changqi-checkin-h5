import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const recipePath = 'assets/illustrations/restoration/recipe.json'
const prefix = 'assets/illustrations/restoration/'
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
function requireValue(condition, message) { if (!condition) throw new Error(message) }
function localPath(root, value) {
  requireValue(typeof value === 'string' && /^(?:assets\/|web\/public\/art\/)[A-Za-z0-9._/-]+$/.test(value) && !value.split('/').includes('..'), `Unsafe artwork path: ${value}`)
  return path.join(root, value)
}
async function raster(bytes, label) {
  const meta = await sharp(bytes, { limitInputPixels: 16000000 }).metadata()
  requireValue(['png', 'webp'].includes(meta.format) && (meta.pages || 1) === 1, `Expected a single PNG/WebP image master: ${label}`)
  return meta
}
async function writeOwned(root, manifestPath, outputs, metadata) {
  let previous = { files: [] }, manifestBefore = null
  try { manifestBefore = await fs.readFile(localPath(root, manifestPath)); previous = JSON.parse(manifestBefore) } catch (error) { if (error.code !== 'ENOENT') throw error }
  requireValue(new Set(outputs.map(file => file.path)).size === outputs.length, 'Duplicate artwork output')
  // All inputs and every existing destination are checked before the first write.
  for (const output of outputs) {
    try {
      const existing = await fs.readFile(localPath(root, output.path))
      requireValue(hash(existing) === hash(output.data) || previous.files?.some(file => file.path === output.path && file.sha256 === hash(existing)), `Preserve modified/unowned artwork: ${output.path}`)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const current = await fs.readFile(localPath(root, manifestPath)).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  requireValue((current === null && manifestBefore === null) || (current !== null && manifestBefore !== null && hash(current) === hash(manifestBefore)), 'Artwork manifest changed during preflight')
  const files = []
  for (const { data, ...file } of outputs) {
    const destination = localPath(root, file.path)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, data)
    files.push({ ...file, bytes: data.length, sha256: hash(data) })
  }
  const manifest = { ...metadata, files }
  await fs.mkdir(path.dirname(localPath(root, manifestPath)), { recursive: true })
  await fs.writeFile(localPath(root, manifestPath), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

// Extraction is intentionally separate from runtime generation: raw crops are never clean masters.
export async function prepareArt({ root = projectRoot, extractSources = false } = {}) {
  const recipeBytes = await fs.readFile(localPath(root, recipePath))
  const recipe = JSON.parse(recipeBytes)
  requireValue(recipe.version === 1 && recipe.crops?.length && recipe.masters?.length, 'Invalid artwork recipe')
  const refBytes = await fs.readFile(localPath(root, recipe.referenceManifest))
  requireValue(hash(refBytes) === recipe.referenceManifestSha256, 'Reference manifest changed')
  const originals = new Map()
  for (const file of JSON.parse(refBytes).files) {
    const bytes = await fs.readFile(localPath(root, file.path))
    requireValue(hash(bytes) === file.sha256, `Approved original changed: ${file.path}`)
    const meta = await raster(bytes, file.path)
    requireValue(meta.width === file.width && meta.height === file.height, `Reference dimensions changed: ${file.path}`)
    originals.set(path.posix.basename(file.path), { ...file, data: bytes })
  }
  if (extractSources) {
    const outputs = []
    for (const entry of recipe.crops) {
      requireValue(/^[a-z0-9-]+$/.test(entry.id), 'Invalid crop id')
      const source = originals.get(entry.reference)
      requireValue(source, `Unknown crop reference: ${entry.reference}`)
      const data = await sharp(source.data).extract(entry.crop).png({ compressionLevel: 9 }).toBuffer()
      const meta = await raster(data, entry.id)
      outputs.push({ path: `${prefix}sources/${entry.id}.png`, data, width: meta.width, height: meta.height, reference: source.path, referenceSha256: source.sha256, crop: entry.crop, use: entry.use })
    }
    return writeOwned(root, `${prefix}source-manifest.json`, outputs, { source: recipePath, sourceSha256: hash(recipeBytes), method: 'Native-pixel PNG crops only; no painting, interpolation, UI removal or runtime adoption. See TASKS for review.' })
  }
  const missing = recipe.masters.filter(entry => !entry.master || entry.master.reviewed !== true)
  requireValue(missing.length === 0, `Image master gate blocked: ${missing.map(entry => entry.id).join(', ')}. No runtime files written; source crops are not UI-free masters.`)
  const outputs = []
  for (const entry of recipe.masters) {
    const master = entry.master
    requireValue(master.path.startsWith(`${prefix}masters/`) && /\.(png|webp)$/.test(master.path), 'Master must be an independent PNG/WebP under restoration/masters')
    requireValue(typeof master.method === 'string' && master.method.trim().length > 0, 'Record the actual image-editing method')
    requireValue(entry.sourceIds?.length && entry.sourceIds.every(id => recipe.crops.some(crop => crop.id === id)), 'Master source lineage missing')
    const bytes = await fs.readFile(localPath(root, master.path))
    requireValue(hash(bytes) === master.sha256, `Master hash changed: ${master.path}`)
    const meta = await raster(bytes, master.path)
    requireValue(meta.width === master.width && meta.height === master.height, `Master dimensions changed: ${master.path}`)
    requireValue(Number.isInteger(entry.maxWidth) && entry.maxWidth > 0 && entry.maxWidth <= 1600, 'Invalid derivative width')
    requireValue(Number.isInteger(entry.maxBytes) && entry.maxBytes > 0 && entry.maxBytes <= 1500000, 'Invalid derivative budget')
    requireValue(/^web\/public\/art\/(?:map|point-[a-z0-9_-]+)-restored-v\d+\.webp$/.test(entry.output), 'Use a versioned restored image filename')
    const data = await sharp(bytes).resize({ width: entry.maxWidth, withoutEnlargement: true }).webp({ quality: 86, effort: 5 }).toBuffer()
    requireValue(data.length <= entry.maxBytes, `Review compression/size instead of silently reducing quality: ${entry.id}`)
    const size = await raster(data, entry.output)
    outputs.push({ path: entry.output, data, width: size.width, height: size.height, master, sourceIds: entry.sourceIds })
  }
  requireValue(outputs.reduce((sum, file) => sum + file.data.length, 0) <= 5000000, 'Review total artwork budget')
  return writeOwned(root, 'web/public/art/illustration-manifest.json', outputs, { source: recipePath, sourceSha256: hash(recipeBytes), method: 'Source-based reviewed raster masters; sharp WebP quality 86, preserve aspect and never enlarge. Model edits are saved masters, not pixel-reproducible generations.' })
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    requireValue(process.argv.slice(2).every(arg => arg === '--extract-sources'), 'Usage: node scripts/prepare-a4-art.mjs [--extract-sources]')
    const result = await prepareArt({ extractSources: process.argv.includes('--extract-sources') })
    for (const file of result.files) console.log(`${file.path}: ${file.width}x${file.height}, ${file.bytes} bytes, sha256=${file.sha256}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
