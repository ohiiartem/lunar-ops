export function mapNavigation(onScale: (px: number) => void) {
  const viewport = document.getElementById('map-view')!
  const stage = document.getElementById('map-stage')!
  let scale = 1, x = 0, y = 0
  let drag: { x: number; y: number; id: number } | undefined
  const render = () => {
    const limit = viewport.clientWidth * (scale - 1) / 2
    x = Math.max(-limit, Math.min(limit, x))
    y = Math.max(-limit, Math.min(limit, y))
    onScale(viewport.clientWidth*scale)
    stage.style.transform = `translate(${x}px,${y}px) scale(${scale})`
  }
  const zoom = (factor: number) => {
    scale = Math.max(1, Math.min(5, scale * factor))
    render()
  }
  const reset = () => { scale = 1; x = 0; y = 0; render() }
  document.getElementById('zoom-in')!.addEventListener('click', () => zoom(1.3))
  document.getElementById('zoom-out')!.addEventListener('click', () => zoom(1/1.3))
  document.getElementById('zoom-reset')!.addEventListener('click', reset)
  viewport.addEventListener('wheel', event => {
    event.preventDefault()
    zoom(Math.exp(-Math.max(-100, Math.min(100,event.deltaY)) * .002))
  }, { passive: false })
  stage.addEventListener('pointerdown', event => {
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId }
    stage.setPointerCapture(event.pointerId)
  })
  stage.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return
    x += event.clientX-drag.x
    y += event.clientY-drag.y
    drag = {x:event.clientX,y:event.clientY,id:event.pointerId}
    render()
  })
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    stage.addEventListener(type,()=>{drag=undefined})
  }
  stage.addEventListener('dragstart',event=>event.preventDefault())
  new ResizeObserver(render).observe(viewport)
  return reset
}
