import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export function dampingAt(seconds: number) {
  return 1 - Math.exp(-9 * Math.min(seconds, .05))
}

/** Render while the camera moves, then let the GPU rest. */
export function smoothOrbit(controls: OrbitControls, draw: () => void) {
  let frame = 0
  let last = 0
  let active = true
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const tick = (now: number) => {
    frame = 0
    if (!active || document.hidden) return
    controls.enableDamping = !reduced.matches
    controls.dampingFactor = dampingAt(last ? (now-last)/1000 : 1/60)
    last = now
    controls.update()
    draw()
  }
  const request = () => {
    if (!frame && active && !document.hidden) frame = requestAnimationFrame(tick)
  }
  controls.addEventListener('change', request)
  document.addEventListener('visibilitychange', request)
  return {
    request,
    active(value: boolean) {
      active = value
      last = 0
      if (!active) { cancelAnimationFrame(frame); frame = 0 }
      else request()
    },
    dispose() {
      active = false
      cancelAnimationFrame(frame)
      controls.removeEventListener('change', request)
      document.removeEventListener('visibilitychange', request)
    },
  }
}
