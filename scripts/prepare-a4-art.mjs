import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

// Derivatives of the approved originals only: no phone frame, interface text, QR or progress.
// These are conceptual village illustrations, not verified photographs or a geographic map.
const items = [
  { source: 'assets/reference/home.png', sha: '60bdd398e9547071278774a5b2c5fe77cccea92c7a65ed3dcf160fa136763713',
    crop: { left: 145, top: 420, width: 650, height: 310 }, output: 'web/public/art/village.webp' },
  { source: 'assets/reference/checkin.png', sha: '60ebb1b73288cd044fc4c8958b63d87909280828f2dde5ca3180502a1e045e63',
    crop: { left: 150, top: 405, width: 640, height: 265 }, output: 'web/public/art/lane.webp' }
]
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
await fs.mkdir('web/public/art', { recursive: true })
for (const item of items) {
  const original = await fs.readFile(item.source)
  if (hash(original) !== item.sha) throw new Error(`Approved source changed: ${item.source}`)
  const bytes = await sharp(original).extract(item.crop).webp({ quality: 82 }).toBuffer()
  try { await fs.writeFile(item.output, bytes, { flag: 'wx' }) } catch (error) {
    if (error.code !== 'EEXIST' || hash(await fs.readFile(item.output)) !== hash(bytes)) throw error
  }
  console.log(`${item.output}: ${bytes.length} bytes; sha256=${hash(bytes)}`)
}
