import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { smoothOrbit } from './motion'
import { colors, directionAt, gridDirection, names, radians, readJson, targets } from './model'
import type { Affine, Metadata, Observations, Site, TerrainGrid } from './model'

export function decodeTerrain(data: DataView, metadata: Metadata): TerrainGrid {
  const size = 512
  const info = metadata.heightmaps['512']
  const elevation_m = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const code = data.getUint16((row * size + col) * 2, true)
      return code === info.nodata_code ? null : info.min_m + (code - 1) * info.step_m
    }))
  return { elevation_m, affine: info.affine }
}

interface WebDem {
  n: number
  size_m: number
  z_min: number
  z_max: number
  north: [number,number]
  east: [number,number]
}

export async function loadSiteTerrain(site: Site, signal?: AbortSignal) {
  const url = import.meta.env.BASE_URL+'dem/'+encodeURIComponent(site.id)
  const meta = await readJson<WebDem>(url+'.json',signal).catch(()=>undefined)
  const metadata: Metadata = {
    longitude_latitude_deg:[site.lon,site.lat],xy_m:[0,0],mast_height_m:0,frame:'',heightmaps:{},
  }
  if (!meta) {
    const grid: TerrainGrid = {elevation_m:[[0,0],[0,0]],affine:[5000,0,-5000,0,-5000,5000],flat:true}
    return { metadata,grid }
  }
  const response = await fetch(url+'.bin',{signal})
  if (!response.ok) throw new Error('Terrain grid unavailable')
  const data = new DataView(await response.arrayBuffer())
  if (meta.n<2 || data.byteLength!==meta.n*meta.n*2) throw new Error('Invalid terrain grid')
  const spacing = meta.size_m/(meta.n-1)
  const edge = spacing*meta.n/2
  const affine: Affine = [spacing,0,-edge,0,-spacing,edge]
  const step = (meta.z_max-meta.z_min)/65535
  const elevation_m = Array.from({length:meta.n},(_,row)=>Array.from({length:meta.n},(_,col)=>
    meta.z_min+step*data.getUint16(2*(row*meta.n+col),true)))
  const grid: TerrainGrid = {elevation_m,affine,axes:{north:meta.north,east:meta.east}}
  return { metadata,grid }
}

export function createTerrain(host: HTMLElement, metadata: Metadata, grid: TerrainGrid, onSurface: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7))
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  renderer.setClearColor(0x000000, 0)
  const scale = Math.max(1,Math.abs(grid.affine[0])*(grid.elevation_m[0].length-1)/5000)
  const camera = new THREE.PerspectiveCamera(42, 1, 5, 30000*scale)
  camera.position.set(5020, 4490, 5630).multiplyScalar(scale)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.rotateSpeed = .55
  controls.zoomSpeed = .65
  controls.minDistance = 500
  controls.maxDistance = 13000*scale
  controls.maxPolarAngle = Math.PI / 2
  const [dx, , x0, , dy, y0] = grid.affine
  const [ox, oy] = metadata.xy_m
  const rows = grid.elevation_m.length
  const cols = grid.elevation_m[0].length
  const col = Math.max(0, Math.min(cols-1, Math.floor((ox-x0)/dx)))
  const row = Math.max(0, Math.min(rows-1, Math.floor((oy-y0)/dy)))
  const base = grid.elevation_m[row][col] ?? 0
  const vertices: number[] = []
  const indices: number[] = []
  const tint: number[] = []
  const color = new THREE.Color()
  const low = new THREE.Color('#555960')
  const high = new THREE.Color('#9c9c9d')
  let min = Infinity
  let max = -Infinity
  for (const line of grid.elevation_m) for (const value of line) {
    if (value !== null) { min = Math.min(min, value); max = Math.max(max, value) }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const value = grid.elevation_m[r][c]
    vertices.push(x0 + (c+.5)*dx - ox, (value ?? base)-base, oy - (y0 + (r+.5)*dy))
    color.copy(low).lerp(high, ((value ?? min)-min)/(max-min || 1))
    tint.push(color.r, color.g, color.b)
    if (r+1 >= rows || c+1 >= cols) continue
    if ([value, grid.elevation_m[r+1][c], grid.elevation_m[r][c+1], grid.elevation_m[r+1][c+1]].includes(null)) continue
    const a = r*cols+c
    indices.push(a,a+cols,a+1,a+1,a+cols,a+cols+1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
  const mesh = new THREE.Mesh(geometry, material)
  geometry.computeBoundingBox()
  scene.add(mesh, new THREE.HemisphereLight('#eeeeff', '#484747', .48))
  const light = new THREE.DirectionalLight('#fffaf4', 2.7)
  light.position.set(-2300, 950, -1600)
  scene.add(light)
  const markerGeometry = new THREE.SphereGeometry(58, 16, 12)
  const markerMaterial = new THREE.MeshBasicMaterial({ color: '#e7c69a', depthTest: false })
  const marker = new THREE.Mesh(markerGeometry, markerMaterial)
  marker.position.y = metadata.mast_height_m
  marker.renderOrder = 3
  scene.add(marker)
  const badges = targets.map(target => {
    const image = document.createElement('canvas')
    image.width = 256
    image.height = 64
    const context = image.getContext('2d')!
    context.fillStyle = '#101821e8'
    context.roundRect(7,5,242,54,18)
    context.fill()
    context.fillStyle = colors[target]
    context.font = 'bold 28px system-ui'
    context.textBaseline = 'middle'
    context.textAlign = 'center'
    context.fillText(names[target],128,32)
    const texture = new THREE.CanvasTexture(image)
    texture.colorSpace = THREE.SRGBColorSpace
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false}))
    badge.scale.set(620,155,1)
    badge.renderOrder = 4
    scene.add(badge)
    return badge
  })
  const arrows = targets.map(target => {
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0,1,0), marker.position, 1100, colors[target], 130, 75)
    // The arrows show directions, including rays blocked by the ground.
    for (const part of [arrow.line, arrow.cone]) {
      const materials = Array.isArray(part.material) ? part.material : [part.material]
      materials.forEach(material => { material.depthTest = false })
      part.renderOrder = 2
    }
    scene.add(arrow)
    return arrow
  })
  const ray = new THREE.Raycaster()
  let pointerStart: [number,number] | undefined
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button===0) pointerStart=[event.clientX,event.clientY]
  })
  renderer.domElement.addEventListener('pointercancel', () => { pointerStart=undefined })
  renderer.domElement.addEventListener('pointerup', event => {
    const start=pointerStart
    pointerStart=undefined
    if (!start || Math.hypot(event.clientX-start[0],event.clientY-start[1])>5) return
    const rect=renderer.domElement.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(2*(event.clientX-rect.left)/rect.width-1,
      1-2*(event.clientY-rect.top)/rect.height),camera)
    if (ray.intersectObject(marker).length || ray.intersectObject(mesh).length) onSurface()
  })
  const draw = () => renderer.render(scene, camera)
  const motion = smoothOrbit(controls, draw)
  const resize = () => {
    const width = host.clientWidth
    const height = host.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  resize()
  return {
    reset() { controls.reset(); draw() },
    zoom(factor: number) {
      const distance = camera.position.distanceTo(controls.target)
      const next = THREE.MathUtils.clamp(distance*factor,controls.minDistance,controls.maxDistance)
      camera.position.sub(controls.target).setLength(next).add(controls.target)
      controls.update()
      draw()
    },
    style(exaggeration: number, wireframe: boolean, directions: boolean) {
      mesh.scale.y = exaggeration
      material.wireframe = wireframe
      arrows.forEach(arrow => { arrow.visible = directions })
      badges.forEach(badge => { badge.visible = directions })
      draw()
    },
    update(observations: Observations, index: number) {
      targets.forEach((target, n) => {
        const [azimuth, elevation] = directionAt(observations,target,index)
        const bearing = azimuth*radians
        const { axes } = grid
        const [x,y] = axes ? axes.north.map((value,i)=>value*Math.cos(bearing)+axes.east[i]*Math.sin(bearing))
          : gridDirection(metadata.longitude_latitude_deg[0],azimuth)
        const angle = elevation * radians
        const direction = new THREE.Vector3(x*Math.cos(angle), Math.sin(angle), -y*Math.cos(angle))
        if (target==='Sun') {
          light.position.copy(direction).multiplyScalar(5000)
        }
        arrows[n].setDirection(direction)
        badges[n].position.copy(marker.position).addScaledVector(direction,1250)
      })
      draw()
    },
    dispose() {
      observer.disconnect()
      motion.dispose()
      controls.dispose()
      geometry.dispose()
      material.dispose()
      markerGeometry.dispose()
      markerMaterial.dispose()
      arrows.forEach(arrow => arrow.dispose())
      for (const badge of badges) {
        badge.material.map?.dispose()
        badge.material.dispose()
      }
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
