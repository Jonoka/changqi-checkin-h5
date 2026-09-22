// Layout only: identity, artwork and completion always come from each point's key/config.
export function villageMapLayout(points) {
  const width = 360
  const height = Math.max(620, points.length * 112 + 60)
  const manual = points.every(point => Number.isFinite(point.mapPosition?.x) && Number.isFinite(point.mapPosition?.y))
  const nodes = points.map((point, index) => {
    // If a new point has no manual position, lay out the entire set on a simple alternating trail.
    // Fixed vertical spacing and two separated columns avoid collisions with existing manual pins.
    const x = manual ? point.mapPosition.x / 100 * width : width * (points.length === 1 ? .5 : index % 2 ? .73 : .27)
    const y = manual ? point.mapPosition.y / 100 * height : points.length === 1 ? height / 2 : height - 90 - index * ((height - 180) / (points.length - 1))
    return { point, x, y }
  })
  const route = nodes.map((node, index) => {
    if (!index) return `M ${node.x} ${node.y}`
    const previous = nodes[index - 1]
    const middle = (previous.y + node.y) / 2
    return `C ${previous.x} ${middle}, ${node.x} ${middle}, ${node.x} ${node.y}`
  }).join(' ')
  return { width, height, nodes, route, placement: manual ? 'configured' : 'fallback' }
}
