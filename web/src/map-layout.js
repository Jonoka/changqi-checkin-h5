// Artwork remains raster; only the route/markers below model the supplied field layout.
export const mapArtwork = Object.freeze({ image: '/art/map-restored-v1.webp', width: 1334, height: 1179 })

// Percent coordinates traced from the user-supplied field route reference.
// They are physical route geometry, not a required check-in sequence.
export const mapRouteSegments = Object.freeze([
  [[10.94,43.22],[32.18,24.88],[38.43,49.59],[41.11,57.69]],
  [[41.11,57.69],[42.19,58.18],[45.65,56.94],[52.69,77.36],[64.45,68.84]],
  [[64.45,68.84],[63.53,69.34],[52.88,77.19],[52.88,78.76],[55.42,89.34],[65.23,88.26],[67.24,88.68],[66.60,90.83]],
  [[64.45,68.84],[63.38,65.04],[72.90,59.67],[74.71,62.40]],
  [[74.71,62.40],[75.20,60.74],[77.10,59.17],[78.47,53.80],[77.00,46.45],[77.83,40.91],[76.81,35.87]]
])

function validPosition(value) {
  const { x, y } = value || {}
  return Number.isFinite(x) && x >= 5 && x <= 95 && Number.isFinite(y) && y >= 5 && y <= 95
}

export function villageMapLayout(points, claimMapPosition = null) {
  const nodes = [], unmappedKeys = []
  for (const point of points) {
    if (validPosition(point.mapPosition)) nodes.push({ point, x: point.mapPosition.x, y: point.mapPosition.y })
    else unmappedKeys.push(point.key)
  }
  return {
    ...mapArtwork,
    nodes,
    unmappedKeys,
    routeSegments: mapRouteSegments,
    claimPosition: validPosition(claimMapPosition) ? claimMapPosition : null,
    placement: 'field-reference'
  }
}
