type Point = { x: number; y: number }
type Size = { width: number; height: number }
type LabelBox = Point & Size

export function placeGlobeLabel(preferred: Point, size: Size, viewport: Size, occupied: LabelBox[]) {
  const gap = 8
  const right = viewport.width - size.width - gap
  const bottom = viewport.height - size.height - gap
  if (right < gap || bottom < gap) return

  const x = Math.max(gap, Math.min(right, preferred.x))
  const y = Math.max(gap, Math.min(bottom, preferred.y))
  const columns = [x]
  const rows = [y]
  for (const label of occupied) {
    columns.push(label.x - gap - size.width, label.x + label.width + gap)
    rows.push(label.y - gap - size.height, label.y + label.height + gap)
  }

  let nearest: LabelBox | undefined
  let nearestDistance = Infinity
  for (const left of columns) {
    if (left < gap || left > right) continue
    for (const top of rows) {
      if (top < gap || top > bottom) continue
      const distance = (left - x) ** 2 + (top - y) ** 2
      if (distance >= nearestDistance) continue
      const overlaps = occupied.some(label =>
        left < label.x + label.width + gap && left > label.x - gap - size.width &&
        top < label.y + label.height + gap && top > label.y - gap - size.height,
      )
      if (overlaps) continue
      nearest = { ...size, x: left, y: top }
      nearestDistance = distance
    }
  }
  return nearest
}
