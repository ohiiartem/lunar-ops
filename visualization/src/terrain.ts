import { sunTexture } from './sun-texture'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { smoothOrbit } from './motion'
import { colors, directionAt, gridDirection, radians, readJson, targets } from './model'
import type { Affine, Metadata, Observations, Site, Target, TerrainGrid } from './model'

export function decodeTerrain(data: DataView, metadata: Metadata, size = 512): TerrainGrid {
  const info = metadata.heightmaps[String(size)]
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

export function createTerrain(host: HTMLElement, metadata: Metadata, grid: TerrainGrid, siteName: string, onSurface: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.25 : 1.7))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  renderer.setClearColor(0x000000, 0)
  const scale = Math.max(1,Math.abs(grid.affine[0])*(grid.elevation_m[0].length-1)/5000)
  const orbitRadius = 3400 * scale
  const overviewRadius = orbitRadius + 650 * scale
  const overview = new THREE.Vector3(5020, 4490, 5630).normalize()
  const camera = new THREE.PerspectiveCamera(42, 1, 5, 60000*scale)
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
  // Typed arrays: a 1024 grid has over a million vertices and six million indices.
  const vertices = new Float32Array(rows*cols*3)
  const indices = new Uint32Array((rows-1)*(cols-1)*6)
  let indexCount = 0
  const tint = new Float32Array(rows*cols*3)
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
    const a = r*cols+c
    vertices.set([x0 + (c+.5)*dx - ox, (value ?? base)-base, oy - (y0 + (r+.5)*dy)], a*3)
    color.copy(low).lerp(high, ((value ?? min)-min)/(max-min || 1))
    tint.set([color.r, color.g, color.b], a*3)
    if (r+1 >= rows || c+1 >= cols) continue
    if ([value, grid.elevation_m[r+1][c], grid.elevation_m[r][c+1], grid.elevation_m[r+1][c+1]].includes(null)) continue
    indices.set([a,a+cols,a+1,a+1,a+cols,a+cols+1], indexCount)
    indexCount += 6
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(tint, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexCount), 1))
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
  const mesh = new THREE.Mesh(geometry, material)
  geometry.computeBoundingBox()
  // Sharp shadows: each pixel marches a ray towards the Sun over the height grid.
  // Add ?shadows=map to the URL to use the shadow map instead.
  const shadowMode = new URLSearchParams(location.search).get('shadows')
  const rayShadows = !grid.flat && shadowMode !== 'map' &&
    (shadowMode === 'ray' || !matchMedia('(pointer: coarse)').matches)
  const rm = {
    uHeight: { value: null as THREE.DataTexture | null },
    uGrid: { value: new THREE.Vector4(x0-ox, oy-y0, dx*cols, dy*rows) },
    uSunDir: { value: new THREE.Vector3(0,1,0) },
    uExag: { value: 1 },
    uMaxH: { value: max-base },
    uMinH: { value: min-base },
  }
  if (rayShadows) {
    const heights = new Float32Array(rows*cols)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights[r*cols+c] = (grid.elevation_m[r][c] ?? base)-base
    const texture = new THREE.DataTexture(heights, cols, rows, THREE.RedFormat, THREE.FloatType)
    const linear = renderer.extensions.has('OES_texture_float_linear')
    texture.minFilter = texture.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter
    texture.needsUpdate = true
    rm.uHeight.value = texture
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, rm)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRmPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRmPos = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vRmPos;
uniform sampler2D uHeight;
uniform vec4 uGrid;
uniform vec3 uSunDir;
uniform float uExag;
uniform float uMaxH;
uniform float uMinH;
float rmHeight(vec2 xz) {
  vec2 uv = vec2((xz.x-uGrid.x)/uGrid.z, (uGrid.y-xz.y)/uGrid.w);
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return -1e6;
  return texture2D(uHeight, uv).r;
}
// 1 = lit, 0 = in shadow. The penumbra width follows the Sun's angular size (about 0.53 deg).
float rmShadow() {
  vec3 origin = vec3(vRmPos.x, vRmPos.y*uExag, vRmPos.z);
  vec3 dir = normalize(uSunDir);
  float lit = 1.;
  float t = 2.;
  for (int i = 0; i < 128; i++) {
    vec3 q = origin + dir*t;
    if ((dir.y > 0. && q.y > uMaxH*uExag + 5.) || (dir.y < 0. && q.y < uMinH*uExag - 5.)) break;
    float h = rmHeight(q.xz);
    if (h < -1e5) break;
    lit = min(lit, clamp((q.y - h*uExag + 0.4)/(t*0.0093), 0., 1.));
    if (lit <= 0.) break;
    t += max(3., t*.045);
  }
  return lit * lit * (3. - 2.*lit);
}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float rmLit = rmShadow();
  reflectedLight.directDiffuse *= rmLit;
  reflectedLight.directSpecular *= rmLit;
}`)
    }
  }
  mesh.castShadow = !grid.flat && !rayShadows
  mesh.receiveShadow = !grid.flat && !rayShadows
  // Keep the terrain readable when the API reports no direct sunlight.
  // In sunlight the fill is nearly off, so shadows stay almost black as on the real Moon.
  const fill = new THREE.HemisphereLight('#dce8ff', '#727886', .63)
  fill.position.set(-.5, 1, .35)
  const ambient = new THREE.AmbientLight('#e4ecff', .24)
  scene.add(mesh, fill, ambient)
  const light = new THREE.DirectionalLight('#fff1dc', 0)
  const shadowDirection = new THREE.Vector3()
  // Reuse the depth pass between small changes in the Sun's direction.
  const shadowUpdateCosine = Math.cos(.12 * radians)
  light.castShadow = !grid.flat && !rayShadows
  light.shadow.mapSize.set(4096, 4096)
  light.shadow.radius = 1.5
  light.shadow.bias = -.00012
  light.shadow.normalBias = 4 * scale
  scene.add(light)
  const markerGeometry = new THREE.SphereGeometry(25*scale, 12, 8)
  const markerMaterial = new THREE.MeshBasicMaterial({ color: '#ffe0aa', depthTest: false })
  const marker = new THREE.Mesh(markerGeometry, markerMaterial)
  marker.position.y = metadata.mast_height_m
  marker.renderOrder = 3
  scene.add(marker)

  const sphere = new THREE.SphereGeometry(1,64,40)
  const sunMap = sunTexture()
  const earthMap = new THREE.TextureLoader().load(import.meta.env.BASE_URL+'earth-atmos.jpg',()=>draw())
  earthMap.colorSpace = THREE.SRGBColorSpace
  const sun = new THREE.Mesh(sphere,new THREE.MeshBasicMaterial({map:sunMap,toneMapped:false}))
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: { surface: { value: earthMap }, sunDirection: { value: new THREE.Vector3(0,1,0) } },
    vertexShader: `
      varying vec2 surfaceUV;
      varying vec3 surfaceNormal;
      void main() {
        surfaceUV = uv;
        surfaceNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D surface;
      uniform vec3 sunDirection;
      varying vec2 surfaceUV;
      varying vec3 surfaceNormal;
      void main() {
        vec3 normal = normalize(surfaceNormal);
        float daylight = smoothstep(-0.06, 0.72, dot(normal, sunDirection));
        vec3 color = texture2D(surface, surfaceUV).rgb * mix(vec3(0.13, 0.20, 0.34), vec3(1.24, 1.19, 1.12), daylight);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const earth = new THREE.Mesh(sphere,earthMaterial)
  sun.scale.setScalar(255*scale)
  earth.scale.setScalar(195*scale)

  const haloMaterial = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 haloUV;
      void main() {
        haloUV = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 haloUV;
      void main() {
        float radius = length(haloUV - 0.5) * 2.0;
        float glow = exp(-radius * radius * 10.0) * (1.0 - smoothstep(0.7, 1.0, radius));
        gl_FragColor = vec4(1.0, 0.54, 0.20, glow * 0.56);
      }
    `,
  })
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1300*scale, 1300*scale), haloMaterial)
  scene.add(sun,earth,halo)
  const earthshine = new THREE.DirectionalLight(0xa7cbff,0)
  scene.add(earthshine)
  const bodies = {Sun:sun,Earth:earth}
  const tracks = targets.map(target => {
    const track = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({color:colors[target], transparent:true, opacity:.43, depthWrite:false}))
    scene.add(track)
    return track
  })
  let activeObservations: Observations | undefined
  function localDirection(azimuth: number, elevation: number) {
    const bearing = azimuth*radians
    const { axes } = grid
    const [x,y] = axes ? axes.north.map((value,i)=>value*Math.cos(bearing)+axes.east[i]*Math.sin(bearing))
      : gridDirection(metadata.longitude_latitude_deg[0],azimuth)
    const angle = elevation * radians
    return new THREE.Vector3(x*Math.cos(angle), Math.sin(angle), -y*Math.cos(angle)).normalize()
  }

  const labels = ([[marker,siteName],[sun,'Sun'],[earth,'Earth']] as const).map(([body,name]) => {
    const label = document.createElement('span')
    label.className = 'terrain-body-label'
    label.textContent = name
    label.hidden = true
    host.append(label)
    return {body,label}
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
  const projected = new THREE.Vector3()
  const cameraUp = new THREE.Vector3()
  const draw = () => {
    halo.quaternion.copy(camera.quaternion)
    renderer.render(scene, camera)
    cameraUp.set(0,1,0).applyQuaternion(camera.quaternion)
    for (const {body,label} of labels) {
      const radius = body === marker ? 25*scale : body.scale.x
      projected.copy(body.position).addScaledVector(cameraUp,radius).project(camera)
      label.hidden = !body.visible || Math.abs(projected.x)>1 || Math.abs(projected.y)>1 || Math.abs(projected.z)>1
      if (label.hidden) continue
      const halfWidth = label.offsetWidth / 2
      const x = THREE.MathUtils.clamp((projected.x*.5+.5)*host.clientWidth,
        halfWidth+6, host.clientWidth-halfWidth-6)
      const y = Math.max((.5-projected.y*.5)*host.clientHeight, label.offsetHeight+11)
      label.style.left = `${x}px`
      label.style.top = `${y}px`
    }
  }
  sun.visible = earth.visible = halo.visible = false
  function reset() {
    const halfField = Math.atan(Math.tan(camera.fov*radians/2)*Math.min(1,camera.aspect))
    const distance = overviewRadius/Math.sin(halfField)*1.04
    controls.maxDistance = Math.max(13000*scale, distance*1.4)
    camera.position.copy(overview).multiplyScalar(distance)
    controls.target.set(0,0,0)
    controls.update()
    draw()
  }
  const motion = smoothOrbit(controls, draw)
  const resize = () => {
    const width = host.clientWidth
    const height = host.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (!framed) { framed = true; reset() } else draw()
  }
  let framed = false
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  resize()
  return {
    reset,
    zoom(factor: number) {
      const distance = camera.position.distanceTo(controls.target)
      const next = THREE.MathUtils.clamp(distance*factor,controls.minDistance,controls.maxDistance)
      camera.position.sub(controls.target).setLength(next).add(controls.target)
      controls.update()
      draw()
    },
    style(exaggeration: number, wireframe: boolean, directions: boolean) {
      mesh.scale.y = exaggeration
      rm.uExag.value = exaggeration
      const {min,max} = geometry.boundingBox!
      const bounds = Math.hypot(Math.max(Math.abs(min.x),Math.abs(max.x)),
        Math.max(Math.abs(min.y),Math.abs(max.y))*exaggeration,
        Math.max(Math.abs(min.z),Math.abs(max.z)))+250*scale
      const shadow = light.shadow.camera
      shadow.left = shadow.bottom = -bounds
      shadow.right = shadow.top = bounds
      shadow.near = 1
      shadow.far = 4*bounds
      shadow.updateProjectionMatrix()
      shadowDirection.set(0,0,0)
      renderer.shadowMap.needsUpdate = true
      material.wireframe = wireframe
      arrows.forEach(arrow => { arrow.visible = directions })
      draw()
    },
    update(observations: Observations, index: number) {
      if (activeObservations !== observations) {
        activeObservations = observations
        targets.forEach((target, n) => {
          const points = observations[target].map(([azimuth,elevation]) =>
            localDirection(azimuth,elevation).multiplyScalar(orbitRadius).add(marker.position))
          tracks[n].geometry.dispose()
          tracks[n].geometry = new THREE.BufferGeometry().setFromPoints(points)
        })
      }
      targets.forEach((target, n) => {
        const [azimuth,elevation] = directionAt(observations,target,index)
        const direction = localDirection(azimuth,elevation)
        if (target==='Sun') {
          // The API visibility flag describes the landing point. The depth map
          // determines which slopes and depressions in the rest of the mesh receive light.
          light.position.copy(direction).multiplyScalar(2*light.shadow.camera.right)
          rm.uSunDir.value.copy(direction)
          const day = THREE.MathUtils.smoothstep(elevation,-3,-.5)
          light.intensity = 3.6 * day
          fill.intensity = THREE.MathUtils.lerp(.63,.07,day)
          ambient.intensity = THREE.MathUtils.lerp(.24,.02,day)
          if (light.castShadow && light.intensity>0 && shadowDirection.dot(direction)<shadowUpdateCosine) {
            shadowDirection.copy(direction)
            renderer.shadowMap.needsUpdate = true
          }
        } else {
          const rows = observations.Earth
          const sample = THREE.MathUtils.clamp(index,0,rows.length-1)
          const lower = Math.floor(sample)
          const visible = THREE.MathUtils.lerp(Number(rows[lower][3]),
            Number(rows[Math.min(lower+1,rows.length-1)][3]), sample-lower)
          earthshine.position.copy(direction).multiplyScalar(5000)
          earthshine.intensity = .06 * visible
        }
        bodies[target].position.copy(marker.position).addScaledVector(direction,orbitRadius)
        arrows[n].setDirection(direction)
      })
      earthMaterial.uniforms.sunDirection.value.subVectors(sun.position,earth.position).normalize()
      halo.position.copy(sun.position)
      sun.visible = earth.visible = halo.visible = true
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
      tracks.forEach(track => { track.geometry.dispose(); track.material.dispose() })
      labels.forEach(({label}) => label.remove())
      halo.geometry.dispose()
      haloMaterial.dispose()
      light.shadow.dispose()
      sphere.dispose()
      sun.material.dispose()
      earth.material.dispose()
      sunMap.dispose()
      earthMap.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
