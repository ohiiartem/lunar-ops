import { sunTexture } from './sun-texture'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { smoothOrbit } from './motion'
import { colors, radians, readJson } from './model'
import type { Target } from './model'

interface VectorSamples {
  start: string
  stepMs: number
  xyz: [number,number,number][]
}

function orbitTrack(samples:VectorSamples, unitsPerKm:number, color:string) {
  // Three.js uses Y up. Map ecliptic XY to scene XZ, retaining handedness.
  const points = samples.xyz.map(([x,y,z])=>new THREE.Vector3(x,z,-y).multiplyScalar(unitsPerKm))
  const geometry = new LineGeometry().setPositions(points.flatMap(point=>point.toArray()))
  const material = new LineMaterial({color,linewidth:1.65,transparent:true,opacity:.62,depthWrite:false})
  const line = new Line2(geometry,material)
  const start = Date.parse(samples.start)
  return {
    line,
    covers(time:number) { return time>=start && time<=start+samples.stepMs*(points.length-1) },
    position(time:number,out:THREE.Vector3) {
      const sample = THREE.MathUtils.clamp((time-start)/samples.stepMs,0,points.length-1)
      const index = Math.floor(sample)
      return out.copy(points[index]).lerp(points[Math.min(index+1,points.length-1)],sample-index)
    },
    dispose() { geometry.dispose(); material.dispose() },
  }
}



export type SystemBody = Target | 'Moon'

export async function createSolarSystem(host: HTMLElement, onSelect: (body: SystemBody) => void) {
  const loader = new THREE.TextureLoader()
  const base = import.meta.env.BASE_URL
  const [orbits,earthMap,moonMap] = await Promise.all([
    readJson<{earth:VectorSamples;moon:VectorSamples}>(base+'data/system-orbits.json'),
    loader.loadAsync(base+'earth-atmos.jpg'), loader.loadAsync(base+'lroc_color_2k.jpg'),
  ])
  earthMap.colorSpace = moonMap.colorSpace = THREE.SRGBColorSpace
  let renderer: THREE.WebGLRenderer
  try { renderer = new THREE.WebGLRenderer({alpha:true,antialias:true}) }
  catch (error) { earthMap.dispose(); moonMap.dispose(); throw error }
  renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.25 : 1.7))
  renderer.domElement.setAttribute('aria-label','Interactive Sun, Earth and Moon simulation')
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(37,1,.05,250)
  const controls = new OrbitControls(camera,renderer.domElement)
  controls.minDistance = 1.2
  controls.maxDistance = 60
  const geometry = new THREE.SphereGeometry(1,64,40)
  const solarMap = sunTexture()
  const sun = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:solarMap,toneMapped:false}))
  const earth = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:earthMap,roughness:.85}))
  const moon = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:moonMap,roughness:1}))
  sun.scale.setScalar(2.18)
  earth.scale.setScalar(.92)
  moon.scale.setScalar(.57)
  const bodies = {Earth:earth, Sun:sun, Moon:moon}
  const earthOrbit = orbitTrack(orbits.earth,12.5/149_597_870,colors.Earth)
  const moonOrbit = orbitTrack(orbits.moon,2.9/384_400,'#c1b9f8')
  const sunlight = new THREE.PointLight(0xfff1db,2.8,0,0)
  scene.add(sun,earth,moon,earthOrbit.line,moonOrbit.line,sunlight,new THREE.AmbientLight(0xe7f0ff,1.05))

  const haloCanvas = document.createElement('canvas')
  haloCanvas.width = haloCanvas.height = 128
  const haloContext = haloCanvas.getContext('2d')!
  const glow = haloContext.createRadialGradient(64,64,0,64,64,64)
  glow.addColorStop(0,'rgba(255,188,94,.38)')
  glow.addColorStop(.44,'rgba(255,157,69,.19)')
  glow.addColorStop(.68,'rgba(245,126,38,.05)')
  glow.addColorStop(1,'rgba(245,126,38,0)')
  haloContext.fillStyle = glow
  haloContext.fillRect(0,0,128,128)
  const haloTexture = new THREE.CanvasTexture(haloCanvas)
  haloTexture.colorSpace = THREE.SRGBColorSpace
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({map:haloTexture,transparent:true,depthWrite:false,depthTest:false}))
  halo.scale.set(10,10,1)
  scene.add(halo)
  const labels = new Map<THREE.Mesh,HTMLButtonElement>()
  const cameraUp = new THREE.Vector3()
  host.replaceChildren(renderer.domElement)
  for (const [name,body] of [['Sun',sun],['Earth',earth],['Moon',moon]] as const) {
    const label=document.createElement('button')
    label.type='button'
    label.onclick=()=>onSelect(name)
    label.className='system-body-label'
    label.dataset.systemBody=name
    label.textContent=name
    if (name==='Moon') label.setAttribute('aria-label','Open Moon globe')
    host.append(label)
    labels.set(body,label)
  }

  const draw = () => {
    renderer.render(scene,camera)
    const width = host.clientWidth, height = host.clientHeight
    cameraUp.set(0,1,0).applyQuaternion(camera.quaternion)
    for (const [body,label] of labels) {
      const point = body.position.clone().addScaledVector(cameraUp,body.scale.x+.24).project(camera)
      label.hidden = !body.visible || Math.abs(point.x)>1 || Math.abs(point.y)>1 || Math.abs(point.z)>1
      const x = (point.x*.5+.5)*width
      const y = (.5-point.y*.5)*height
      label.style.transform = `translate(${x}px,${y}px) translate(-50%, -50%)`
    }
  }
  const motion = smoothOrbit(controls,draw)
  let focused: SystemBody | undefined
  let flight = 0
  let framed = false
  const overviewDirection = new THREE.Vector3(.32,.64,1).normalize()
  const overviewCenter = new THREE.Vector3(1.25,0,-.3)

  function emphasize(body?: SystemBody) {
    earthOrbit.line.material.opacity = body==='Earth' ? .97 : body==='Sun' ? .42 : .7
    moonOrbit.line.material.opacity = body==='Earth'?.94:body==='Sun'?.4:.85
    for (const [name,mesh] of Object.entries(bodies)) {
      labels.get(mesh)!.classList.toggle('is-selected',name===body)
    }
  }

  function framingDistance(radius: number, margin: number) {
    const halfField = Math.atan(Math.tan(camera.fov*radians/2)*Math.min(1,camera.aspect))
    return radius / Math.sin(halfField) * margin
  }

  function reset() {
    cancelAnimationFrame(flight)
    flight = 0
    focused = undefined
    controls.enabled = true
    emphasize()
    const distance = framingDistance(14,1.01)
    camera.position.copy(overviewDirection).multiplyScalar(distance).add(overviewCenter)
    controls.maxDistance = Math.max(60,distance*1.4)
    controls.target.copy(overviewCenter)
    controls.update()
    draw()
  }

  function focus(body: SystemBody) {
    cancelAnimationFrame(flight)
    focused = body
    emphasize(body)
    controls.enabled = false
    controls.enableDamping = false
    controls.update()
    const mesh = bodies[body]
    const startTarget = controls.target.clone()
    const offset = camera.position.clone().sub(startTarget)
    const initialDistance = offset.length()
    const radius = mesh.scale.x
    const endDistance = framingDistance(radius,1.65)
    const start = performance.now()
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 620
    const move = (now: number) => {
      const fraction = duration ? Math.min(1,(now-start)/duration) : 1
      const eased = fraction*fraction*(3-2*fraction)
      controls.target.copy(startTarget).lerp(mesh.position,eased)
      camera.position.copy(offset).setLength(THREE.MathUtils.lerp(initialDistance,endDistance,eased)).add(controls.target)
      controls.update()
      draw()
      if (fraction<1) flight=requestAnimationFrame(move)
      else { flight=0; controls.enabled=true }
    }
    flight=requestAnimationFrame(move)
  }

  const raycaster = new THREE.Raycaster()
  let pointerStart: [number,number] | undefined
  renderer.domElement.addEventListener('pointerdown',event=>{
    if (event.button===0) pointerStart=[event.clientX,event.clientY]
  })
  renderer.domElement.addEventListener('pointerup',event=>{
    const start=pointerStart
    pointerStart=undefined
    if (!start || Math.hypot(event.clientX-start[0],event.clientY-start[1])>5) return
    const rect=renderer.domElement.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2(
      (event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2,
    ),camera)
    const hit=raycaster.intersectObjects(Object.values(bodies).filter(body=>body.visible))[0]
    const name=(Object.keys(bodies) as SystemBody[]).find(body=>bodies[body]===hit?.object)
    if (name) onSelect(name)
  })
  renderer.domElement.addEventListener('pointercancel',()=>{ pointerStart=undefined })

  function sizeScene() {
    if (!host.clientWidth || !host.clientHeight) return
    const previousAspect = camera.aspect
    camera.aspect = host.clientWidth/host.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(host.clientWidth,host.clientHeight,false)
    if (!framed) { framed=true;reset() }
    else if (focused && previousAspect!==camera.aspect) focus(focused)
    else if (!focused && previousAspect!==camera.aspect) reset()
    else draw()
  }
  const resize = new ResizeObserver(sizeScene)
  resize.observe(host)
  sizeScene()
  return {
    reset,
    focus,
    update(time: number) {
      const previousFocus = focused ? bodies[focused].position.clone() : undefined
      earth.visible = earthOrbit.covers(time)
      moon.visible = earth.visible && moonOrbit.covers(time)
      moonOrbit.line.visible = moon.visible
      if (earth.visible) earthOrbit.position(time,earth.position)
      moonOrbit.line.position.copy(earth.position)
      if (moon.visible) moonOrbit.position(time,moon.position).add(earth.position)
      moon.rotation.y = Math.atan2(moon.position.z-earth.position.z,earth.position.x-moon.position.x)
      if (focused && previousFocus && !flight) {
        const delta = bodies[focused].position.clone().sub(previousFocus)
        controls.target.add(delta)
        camera.position.add(delta)
        controls.update()
      }
      earth.rotation.y = (time/86_164_100%1)*2*Math.PI
      draw()
      return earth.visible && moon.visible
    },
    dispose() {
      cancelAnimationFrame(flight)
      resize.disconnect()
      motion.dispose()
      controls.dispose()
      earthOrbit.dispose()
      moonOrbit.dispose()
      halo.material.dispose()
      geometry.dispose()
      for (const body of [sun,earth,moon]) body.material.dispose()
      for (const texture of [solarMap,earthMap,moonMap,haloTexture]) texture.dispose()
      renderer.dispose()
      host.replaceChildren()
    },
  }
}
