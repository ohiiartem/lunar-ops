const preferenceKey = 'lunar-ops:floating-moon'
const periodMs = 8500
const amplitudePx = 3

export function floatingMoon(draw: () => void) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let enabled = true
  try { enabled = localStorage.getItem(preferenceKey) !== 'off' } catch { /* Use default. */ }
  let active = true
  let interacting = false
  let resumeAt = 0
  let frame = 0
  let timer: number | undefined
  let last = 0
  let elapsed = 0
  let pixels = 0

  function stop() {
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    frame = 0
    timer = undefined
    last = 0
  }

  function schedule() {
    if (!enabled || !active || interacting || reducedMotion.matches || document.hidden || frame || timer !== undefined) return
    const delay = resumeAt - performance.now()
    if (delay > 0) {
      timer = window.setTimeout(() => { timer = undefined; schedule() }, delay)
    } else {
      frame = requestAnimationFrame(tick)
    }
  }

  function tick(now: number) {
    frame = 0
    if (!last) last = now
    // A small, slow displacement only needs a light ambient render cadence.
    if (now - last >= 1000 / 45) {
      elapsed = (elapsed + now - last) % periodMs
      last = now
      pixels = amplitudePx * Math.sin(2 * Math.PI * elapsed / periodMs)
      draw()
    }
    schedule()
  }

  function resetPosition() {
    elapsed = 0
    pixels = 0
    if (active && !document.hidden) draw()
  }

  reducedMotion.addEventListener('change', () => {
    stop()
    resetPosition()
    schedule()
  })
  document.addEventListener('visibilitychange', () => {
    stop()
    schedule()
  })

  return {
    get pixels() { return pixels },
    get enabled() { return enabled },
    reducedMotion,
    setEnabled(value: boolean) {
      enabled = value
      try { localStorage.setItem(preferenceKey, value ? 'on' : 'off') } catch { /* Still usable. */ }
      stop()
      if (!value) resetPosition()
      schedule()
    },
    interaction(value: boolean) {
      interacting = value
      stop()
      resumeAt = performance.now() + 300
      schedule()
    },
    active(value: boolean) {
      stop()
      active = value
      interacting = false
      if (!value) resetPosition()
      schedule()
    },
  }
}
