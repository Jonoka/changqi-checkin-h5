export const mapArtwork = Object.freeze({ image: '/art/map-field-final-v2.webp', width: 1377, height: 1142 })

function validPosition(value) {
  const { x, y } = value || {}
  return Number.isFinite(x) && x >= 5 && x <= 95 && Number.isFinite(y) && y >= 5 && y <= 95
}

export function villageMapLayout(points) {
  const nodes = [], unmappedKeys = []
  for (const point of points) {
    if (validPosition(point.mapPosition)) nodes.push({ point, x: point.mapPosition.x, y: point.mapPosition.y })
    else unmappedKeys.push(point.key)
  }
  return {
    ...mapArtwork,
    nodes,
    unmappedKeys,
    placement: 'final-map'
  }
}
