// Artwork geometry only, never a second location list or a source of progress.
export const mapArtwork = Object.freeze({ image: '/art/map-restored-v1.webp', width: 1334, height: 1179 })

export function villageMapLayout(points) {
  const nodes = [], unmappedKeys = []
  for (const point of points) {
    const { x, y } = point.mapPosition || {}
    if (Number.isFinite(x) && x >= 15 && x <= 85 && Number.isFinite(y) && y >= 12 && y <= 88) {
      nodes.push({ point, x, y }) // Percentages in the image's own relative container.
    } else {
      unmappedKeys.push(point.key) // The existing folded list remains the access path.
    }
  }
  return { ...mapArtwork, nodes, unmappedKeys, placement: 'configured' }
}
