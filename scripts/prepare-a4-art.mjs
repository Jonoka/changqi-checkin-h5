import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

import { illustrations } from '../assets/illustrations/village-art.mjs'

// The former village.webp/lane.webp crops contain signs; they are preserved as legacy files,
// not reused or described as text-free. New artwork is authored SVG, then compressed to WebP.
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const originals = {
  'home.png': '60bdd398e9547071278774a5b2c5fe77cccea92c7a65ed3dcf160fa136763713',
  'checkin.png': '60ebb1b73288cd044fc4c8958b63d87909280828f2dde5ca3180502a1e045e63',
  'map.png': 'e9a88e5452aeabde7bf90b72f742643e3a388c652cb4ae57e267d51002a6e078'
}
for (const [name, digest] of Object.entries(originals)) {
  if (hash(await fs.readFile(`assets/reference/${name}`)) !== digest) throw new Error(`Approved original changed: ${name}`)
}
const manifestPath = 'web/public/art/illustration-manifest.json'
let previous = { files: [] }
try { previous = JSON.parse(await fs.readFile(manifestPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const outputs = []
for (const [name, svg] of Object.entries(illustrations)) {
  if (/<text\b|<image\b|<foreignObject\b|<script\b/i.test(svg)) throw new Error(`Unexpected embedded content in ${name}`)
  const bytes = await sharp(Buffer.from(svg), { density: 144 }).resize({ width: 720 }).webp({ quality: 78, effort: 5 }).toBuffer()
  outputs.push({ path: `web/public/art/${name}.webp`, bytes, svgSha256: hash(svg), ...await sharp(bytes).metadata() })
}
// Preflight every existing derivative before any overwrite: preserve unexpected manual edits.
for (const output of outputs) {
  try {
    const existing = await fs.readFile(output.path)
    if (hash(existing) !== hash(output.bytes) && previous.files.find(file => file.path === output.path)?.sha256 !== hash(existing)) {
      throw new Error(`Preserve modified/unowned artwork: ${output.path}`)
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
await fs.mkdir('web/public/art', { recursive: true })
const files = []
for (const { path, bytes, width, height, svgSha256 } of outputs) {
  await fs.writeFile(path, bytes)
  files.push({ path, bytes: bytes.length, width, height, sha256: hash(bytes), svgSha256 })
  console.log(`${path}: ${bytes.length} bytes; sha256=${hash(bytes)}`)
}
await fs.writeFile(manifestPath, JSON.stringify({ source: 'assets/illustrations/village-art.mjs', sourceSha256: hash(await fs.readFile('assets/illustrations/village-art.mjs')), method: 'Original text-free SVG concept artwork; sharp WebP quality 78, width 720. Not verified scenery.', files }, null, 2) + '\n')
