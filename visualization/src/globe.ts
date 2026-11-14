import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { radians } from './model'
import { floatingMoon } from './floating-moon'
import { smoothOrbit } from './motion'
import type { Site } from './model'

function location(lon: number, lat: number) {
  const l = lon*radians, p = lat*radians
  return new THREE.Vector3(Math.cos(p)*Math.cos(l), Math.sin(p), -Math.cos(p)*Math.sin(l))
}

export async function createGlobe(host: HTMLElement, index: HTMLElement, sites: Site[], onSelect: (site: Site) => void) {
  const loader = new THREE.TextureLoader()
  const [map,bumpMap] = await Promise.all([
    loader.loadAsync(import.meta.env.BASE_URL+'lroc_color_2k.jpg'),
    loader.loadAsync(import.meta.env.BASE_URL+'ldem_3_8bit.jpg'),
  ])
  map.colorSpace = THREE.SRGBColorSpace
  const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true})
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7))
  map.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy())
  host.replaceChildren(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34,1,.01,50)
  const overviewDirection = location(-90,-68)
  const southPoleDirection = location(-90,-87)
  const startPosition = overviewDirection.clone().multiplyScalar(4.2)
  let overviewDistance = startPosition.length()
  const radius = 1
  camera.position.copy(startPosition)
  const controls = new OrbitControls(camera,renderer.domElement)
  controls.enablePan = true
  controls.minDistance = 1.15
  controls.maxDistance = 14
  controls.rotateSpeed = .55
  controls.zoomSpeed = .65
  controls.zoomToCursor = true
  const moon = new THREE.Mesh(new THREE.SphereGeometry(radius,160,100),
    new THREE.MeshStandardMaterial({map,bumpMap,bumpScale:.012,roughness:1}))
  // Keep a faint fill on the night side so landmarks remain easy to explore.
  scene.add(moon,new THREE.AmbientLight('white',.12))
  const light = new THREE.DirectionalLight('#fffaf4',2.8)
  light.position.set(1.5,-2.3,4)
  scene.add(light)
  const labels = document.createElement('div')
  labels.className='globe-labels'
  host.append(labels)
  function indexMarker(name:string, select:()=>void) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = name
    button.onclick = select
    index.append(button)
  }
  const connectors = document.createElementNS('http://www.w3.org/2000/svg','svg')
  connectors.classList.add('site-connectors')
  labels.append(connectors)
  const entries = sites.map((site,i)=>{
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.005,12,8),
      new THREE.MeshBasicMaterial({color:i%2===0?'#e7c28b':'#98d7e4'}))
    marker.position.copy(location(site.lon,site.lat)).multiplyScalar(1.003)
    scene.add(marker)
    const button=document.createElement('button')
    button.className='site-marker'
    button.dataset.point=site.id
    button.textContent=site.name
    button.addEventListener('click',()=>onSelect(site))
    indexMarker(site.name,()=>onSelect(site))
    labels.append(button)
    const line=document.createElementNS(connectors.namespaceURI,'line')
    connectors.append(line)
    return {i,site,marker,button,line}
  })
  const catalog = [
    ['South Pole',0,-90],
  ] as const
  const information = document.createElement('div')
  information.className = 'catalog-info'
  information.hidden = true
  host.append(information)
  const landmarks = catalog.map(([name,lon,lat]) => {
    const position = location(lon,lat).multiplyScalar(1.003)
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.006,12,8),
      new THREE.MeshBasicMaterial({color: '#b8d4ff'}))
    marker.position.copy(position)
    scene.add(marker)
    const button = document.createElement('button')
    button.className = 'landmark'
    button.textContent = name
    const showInformation = () => {
      information.hidden = false
      information.replaceChildren()
      const close = document.createElement('button')
      close.textContent = 'Close'
      close.onclick = () => { information.hidden = true }
      const title = document.createElement('strong')
      title.textContent = name
      const description = document.createElement('p')
      description.textContent = 'Lunar south pole'
      const coordinates = document.createElement('p')
      coordinates.className = 'expert-only'
      coordinates.textContent = '90° S'
      const link = document.createElement('a')
      link.href = 'https://planetarynames.wr.usgs.gov/Page/MOON/target'
      link.textContent = 'View source'
      link.target = '_blank'
      link.rel = 'noopener'
      information.append(title,description,coordinates,link,close)
    }
    button.addEventListener('click', showInformation)
    indexMarker(name, async () => {
      const completed = await flyTo(location(lon,lat),false)
      if (completed) showInformation()
    })
    labels.append(button)
    return {position,button}
  })
  const floating = floatingMoon(draw)
  controls.addEventListener('start', () => floating.interaction(true))
  controls.addEventListener('end', () => floating.interaction(false))

  function draw() {
    const width = host.clientWidth
    const height = host.clientHeight
    if (!width || !height) return
    // Shift the projection in screen space. Rendering, labels and raycasting
    // all use this camera, with the orbit pose and lunar coordinates intact.
    camera.projectionMatrix.elements[9] = 2 * floating.pixels / height
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    renderer.render(scene,camera)
    for (const {position,button} of landmarks) {
      const point = position.clone().project(camera)
      button.hidden = position.dot(camera.position.clone().sub(position))<=0
      const x=(point.x*.5+.5)*width
      const y=(-point.y*.5+.5)*height
      button.style.transform = `translate(${Math.max(0,Math.min(width-150,x))}px,${Math.max(0,y-26)}px)`
    }
    connectors.setAttribute('viewBox',`0 0 ${width} ${height}`)
    for(const {i,marker,button,line} of entries) {
      const point=marker.position.clone().project(camera)
      const visible=marker.position.dot(camera.position.clone().sub(marker.position))>0
      button.hidden=!visible
      line.setAttribute('visibility',visible?'visible':'hidden')
      if(!visible) continue
      const x=(point.x*.5+.5)*width,y=(-point.y*.5+.5)*height
      // Keep the scientific points in place and spread their clickable labels.
      const left=i%2===0
      const bx=Math.max(8,Math.min(width-174,x+(left?-194:35)))
      const by=Math.max(8,Math.min(height-60,y+(left?28:-68)+Math.floor(i/2)*52))
      button.style.transform=`translate(${bx}px,${by}px)`
      line.setAttribute('x1',String(x));line.setAttribute('y1',String(y))
      line.setAttribute('x2',String(left?bx+164:bx));line.setAttribute('y2',String(by+25))
    }
  }
  const motion=smoothOrbit(controls,draw)
  const observer=new ResizeObserver(()=>{
    if(!host.clientWidth||!host.clientHeight) return
    renderer.setSize(host.clientWidth,host.clientHeight,false)
    camera.aspect=host.clientWidth/host.clientHeight
    const halfFov = camera.fov*radians/2
    const limitingAngle = Math.atan(Math.tan(halfFov)*Math.min(1,camera.aspect))
    const nextDistance = radius / Math.sin(Math.atan(Math.tan(limitingAngle)*.84))
    const offset = camera.position.clone().sub(controls.target)
    if (controls.enabled) camera.position.copy(controls.target).add(offset.multiplyScalar(nextDistance/overviewDistance))
    overviewDistance = nextDistance
    startPosition.copy(overviewDirection).multiplyScalar(nextDistance)
    controls.maxDistance = nextDistance*2.8
    controls.update()
    camera.updateProjectionMatrix()
    motion.request()
  })
  observer.observe(host)
  floating.active(!host.closest('[hidden]'))
  const raycaster=new THREE.Raycaster()
  let downX=0,downY=0
  renderer.domElement.addEventListener('pointerdown',e=>{downX=e.clientX;downY=e.clientY})
  renderer.domElement.addEventListener('pointerup',e=>{
    if(Math.hypot(e.clientX-downX,e.clientY-downY)>5||!controls.enabled) return
    const rect=renderer.domElement.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,
      -(e.clientY-rect.top)/rect.height*2+1),camera)
    const hit=raycaster.intersectObject(moon)[0]
    if(!hit) return
    const chosen=entries.map(entry=>({entry,distance:hit.point.distanceTo(entry.marker.position)}))
      .sort((a,b)=>a.distance-b.distance)[0]
    if(chosen && chosen.distance<.018) onSelect(chosen.entry.site)
  })
  let animation=0
  let finish: ((completed:boolean)=>void)|undefined
  function cancel() {cancelAnimationFrame(animation);finish?.(false);finish=undefined}
  function flyTo(goalDirection: THREE.Vector3, approach: boolean, distance = Math.max(1.7,overviewDistance*.68)) {
      cancel()
      floating.active(false)
      motion.active(false)
      controls.enableDamping=false
      controls.update()
      controls.enabled=false
      labels.style.opacity='1'
      information.hidden = true
      const start=camera.position.clone()
      const startTarget = controls.target.clone()
      const goal = goalDirection.clone().multiplyScalar(approach?1.24:distance)
      const orientation=new THREE.Quaternion().setFromUnitVectors(start.clone().sub(startTarget).normalize(),goal.clone().normalize())
      const started=performance.now()
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : approach ? 1750 : 1100
      return new Promise<boolean>(resolve=>{
        finish=resolve
        const move=(now:number)=>{
          const t=duration?Math.min(1,(now-started)/duration):1
          const ease = (value: number) => value*value*(3-2*value)
          const alignment = ease(approach ? Math.min(1,t/.52) : t)
          const zoom = ease(approach ? Math.max(0,(t-.38)/.62) : t)
          if (approach) labels.style.opacity = String(1-ease(Math.max(0,(t-.73)/.27)))
          controls.target.copy(startTarget).multiplyScalar(1-alignment)
          camera.position.copy(start).sub(startTarget).applyQuaternion(new THREE.Quaternion().slerp(orientation,alignment))
            .setLength(THREE.MathUtils.lerp(start.distanceTo(startTarget),goal.length(),zoom)).add(controls.target)
          controls.update()
          draw()
          if(t<1) animation=requestAnimationFrame(move)
          else {controls.enabled=true;motion.active(true);if(!approach) floating.active(true);finish=undefined;resolve(true)}
        }
        animation=requestAnimationFrame(move)
      })
  }
  return {
    floating,
    setSunDirection(x: number, y: number, z: number) {
      if (light.position.x===x && light.position.y===y && light.position.z===z) return
      light.position.set(x,y,z)
      motion.request()
    },
    showSouthPole() {
      return flyTo(southPoleDirection,false,overviewDistance)
    },
    focus(site: Site | "pole", approach = true) {
      return flyTo(site==='pole' ? southPoleDirection : location(site.lon,site.lat),approach)
    },
    zoom(factor: number) {
      if (!controls.enabled) return
      const offset = camera.position.clone().sub(controls.target)
      const desired = THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance)
      const initial = offset.length()
      cancel()
      floating.active(false)
      motion.active(false)
      const start = performance.now()
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches?0:220
      const move = (now: number) => {
        const progress = duration?Math.min(1,(now-start)/duration):1
        camera.position.copy(controls.target).add(offset.clone().setLength(
          THREE.MathUtils.lerp(initial,desired,1-(1-progress)**3)))
        controls.update()
        draw()
        if (progress<1) animation=requestAnimationFrame(move)
        else {motion.active(true);floating.active(true)}
      }
      animation=requestAnimationFrame(move)
    },
    suspend() {cancel();floating.active(false);motion.active(false)},
    reset() {
      cancel()
      controls.target.set(0,0,0)
      camera.position.copy(startPosition)
      controls.enabled=true
      controls.enableDamping=false
      labels.style.opacity='1'
      information.hidden = true
      controls.update()
      motion.active(true)
      floating.active(true)
    },
  }
}
