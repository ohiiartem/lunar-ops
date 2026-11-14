import { colors, directionAt, names, targets } from './model'
import type { Observations, Target } from './model'
import type { Horizon } from './sky-data'

const directions = ['N','NE','E','SE','S','SW','W','NW']
const formatAngle = (angle: number) => `${angle.toFixed(2)}°`

export function createSky(host: HTMLElement, surface: boolean, observations: Observations, profile: Horizon, initialIndex:number) {
  const horizon: Horizon = profile.length ? profile : [[0,0],[360,0]]
  const angles = [...horizon.map(point=>point[1]),...targets.flatMap(target=>observations[target].map(row=>row[1]))]
  const minimum = Math.floor(Math.min(-4,...angles))-1
  const maximum = Math.ceil(Math.max(4,...angles))+1
  const normalized = (value:number) => (value%360+360)%360
  const sun = observations.Sun[initialIndex][0]
  const earth = observations.Earth[initialIndex][0]
  const separation = normalized(earth-sun+180)-180
  let center = surface ? normalized(sun+(Math.abs(separation)<106?separation/2:0)) : 180
  let index = initialIndex
  let sample = initialIndex
  let drag: { x:number; center:number }|undefined
  let visible = true
  const width = 680, height = 330, left = 46, right = 656, top = 28, bottom = 287
  const y = (angle:number) => bottom-(angle-minimum)/(maximum-minimum)*(bottom-top)
  const span = surface ? 120 : 360
  const screenAz = (az:number) => normalized(az-center+180)-180
  const x = (offset:number) => left+(offset+span/2)/span*(right-left)
  const azimuthAt = (offset:number) => normalized(center+offset)
  const chart = document.createElementNS('http://www.w3.org/2000/svg','svg')
  chart.setAttribute('viewBox',`0 0 ${width} ${height}`)
  chart.setAttribute('role','img')
  chart.setAttribute('aria-label',surface?'Surface panorama showing Sun, Earth and the lunar terrain horizon':'Full sky plot of azimuth and altitude')
  const terrain = document.createElementNS(chart.namespaceURI,'path')
  terrain.setAttribute('class','sky-silhouette')
  const outline = document.createElementNS(chart.namespaceURI,'path')
  outline.setAttribute('class','sky-outline')
  const mesh = document.createElementNS(chart.namespaceURI,'g')
  const compass = document.createElementNS(chart.namespaceURI,'g')
  const definition = document.createElementNS(chart.namespaceURI,'defs')
  const clipId = surface?'surface-plot':'sky-plot'
  const gradientId = clipId+'-gradient'
  definition.innerHTML = `<clipPath id="${clipId}"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath>
    <linearGradient id="${gradientId}" x2="0%" y2="100%"><stop stop-color="#0a111c"/><stop offset="100%" stop-color="#263948"/></linearGradient>`
  const ground = document.createElementNS(chart.namespaceURI,'g')
  ground.setAttribute('clip-path',`url(#${clipId})`)
  ground.append(terrain,outline)
  const tracks = document.createElementNS(chart.namespaceURI,'g')
  tracks.classList.add('sky-tracks','expert-only')
  if (!surface) {
    for (const target of targets) {
      const rows = observations[target]
      const points = rows.map(row=>[x(screenAz(row[0])),y(row[1])])
      const line = points.map(([px,py],i)=>{
        const connected = i>0 && Math.abs(px-points[i-1][0])<(right-left)/2
        return `${connected?'L':'M'}${px.toFixed(2)},${py.toFixed(2)}`
      }).join('')
      tracks.innerHTML += `<path stroke="${colors[target]}" opacity=".36" fill="none" d="${line}"/>`+
        rows.map((row,i)=>{
          if (i%4!==0 && rows[i-1]?.[3]===row[3]) return ''
          const shown = row[3]
          return `<circle cx="${points[i][0].toFixed(2)}" cy="${points[i][1].toFixed(2)}" r="${shown?1.65:1.45}"
            fill="${shown?colors[target]:'none'}" stroke="${colors[target]}" opacity="${shown?.6:.28}"/>`
        }).join('')
    }
    ground.append(tracks)
  }
  const markers = new Map<Target,Element>()
  for (const target of targets) {
    const group = document.createElementNS(chart.namespaceURI,'g')
    group.setAttribute('data-sky-body',target)
    group.setAttribute('fill',colors[target])
    group.innerHTML = `<circle r="${target==='Sun'?8:6}" stroke="${colors[target]}" stroke-width="2"/>
      <text y="-13" x="0" text-anchor="middle" fill="${colors[target]}">${names[target]}</text>`
    ground.append(group)
    markers.set(target,group)
  }
  chart.append(definition,mesh,ground,compass)
  const readout = document.createElement('p')
  readout.className = 'sky-readout expert-only'
  const notice = document.createElement('p')
  notice.className = 'caption expert-only'
  notice.textContent = `${profile.length?'LOLA terrain horizon':'Level horizon'} · Vertical scale is exaggerated`
  const guide = document.createElement('p')
  guide.className = 'caption simple-only'
  guide.textContent = profile.length
    ? 'The outline shows the hills around this site. A hollow symbol marks an object hidden at the selected time. Heights are stretched so small changes are easier to see.'
    : 'The straight line shows the level horizon used for this scenario.'
  host.replaceChildren(chart,readout,guide,notice)

  const step = Math.max(1, Math.ceil((maximum-minimum)/7))
  mesh.innerHTML = `<rect fill="url(#${gradientId})" x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/>`
  for (let alt=Math.ceil(minimum/step)*step;alt<=maximum;alt+=step) {
    mesh.innerHTML += `<line class="sky-grid expert-only" x1="${left}" y1="${y(alt)}" x2="${right}" y2="${y(alt)}"/><text class="expert-only" x="${left-8}" y="${y(alt)+4}" text-anchor="end">${alt}°</text>`
  }

  function horizonAt(azimuth:number) {
    const next = horizon.findIndex(point=>point[0]>azimuth)
    const lower = next>0 ? horizon[next-1] : horizon.at(-1)!
    const upper = next>=0 ? horizon[next] : horizon[0]
    const distance = normalized(upper[0]-lower[0])
    return distance ? lower[1]+normalized(azimuth-lower[0])/distance*(upper[1]-lower[1]) : lower[1]
  }

  function drawGround() {
    const points = Array.from({length:span+1},(_,i)=>{
      const offset = i-span/2
      return `${x(offset).toFixed(2)} ${y(horizonAt(azimuthAt(offset))).toFixed(2)}`
    })
    const path = 'M'+points.join('L')
    terrain.setAttribute('d',`${path}L${right} ${bottom}H${left}Z`)
    outline.setAttribute('d',path)
    const compassMarks = directions.flatMap((label,i)=>{
      const offset = screenAz(i*45)
      const offsets = !surface && offset===-180 ? [-180,180] : [offset]
      return offsets.filter(o=>Math.abs(o)<=span/2).map(o=>
        `<path class="sky-grid" d="M${x(o)} ${top}V${bottom}"/><text x="${x(o)}" y="${bottom+21}" text-anchor="middle">${label}</text>`)
    }).join('')
    compass.innerHTML = compassMarks + `<text class="expert-only" x="${(left+right)/2}" y="${height-3}" text-anchor="middle">Azimuth${surface?' · drag to turn':' · 0–360°'}</text>
      <text class="expert-only" x="${left}" y="${top-9}">Altitude</text>
      <text class="simple-only" x="${(left+right)/2}" y="${height-3}" text-anchor="middle">Compass direction</text>`
  }

  function drawBodies() {
    for (const target of targets) {
      const [azimuth,altitude] = directionAt(observations,target,index)
      const offset = screenAz(azimuth)
      const marker = markers.get(target)!
      marker.setAttribute('display',visible && Math.abs(offset)<=span/2 ? 'inline' : 'none')
      marker.setAttribute('transform',`translate(${x(offset)} ${y(altitude)})`)
      const row = observations[target][Math.floor(index)]
      const obscured = !row[3]
      marker.querySelector('circle')!.setAttribute('fill',obscured?'#172331':colors[target])
      marker.setAttribute('opacity',obscured ? '.68':'1')
    }
  }

  function turn(degrees:number) {
    if (!surface) return
    center = normalized(center+degrees)
    drawGround()
    drawBodies()
  }

  if (surface) {
    chart.classList.add('surface-chart')
    chart.setAttribute('tabindex','0')
    chart.addEventListener('pointerdown',event=>{
      drag = {x:event.clientX,center}
      chart.setPointerCapture(event.pointerId)
    })
    chart.addEventListener('pointermove',event=>{
      if (drag) turn(drag.center-center-(event.clientX-drag.x)*span/chart.getBoundingClientRect().width)
    })
    for (const event of ['pointerup','pointercancel','lostpointercapture']) chart.addEventListener(event,()=>{drag=undefined})
    chart.addEventListener('keydown',event=>{
      if (event.key==='ArrowLeft'||event.key==='ArrowRight') {
        event.preventDefault()
        turn(event.key==='ArrowLeft'?-15:15)
      }
    })
  }
  drawGround()
  return {
    turn,
    update(position:number, selected:number, showDirections:boolean) {
      index=position
      visible=showDirections
      tracks.setAttribute('display',showDirections?'inline':'none')
      if (selected!==sample || !readout.textContent) {
        sample=selected
        readout.textContent=targets.map(target=>{
          const [azimuth,altitude,,status]=observations[target][sample]
          return `${names[target]} ${formatAngle(azimuth)} az · ${formatAngle(altitude)} alt · ${status?'visible':'hidden'}`
        }).join('  |  ')
      }
      drawBodies()
    },
  }
}
