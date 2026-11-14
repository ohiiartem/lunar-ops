import * as THREE from 'three'

export function sunTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const image = context.createImageData(canvas.width,canvas.height)
  for (let y=0;y<canvas.height;y++) for (let x=0;x<canvas.width;x++) {
    const longitude = x/canvas.width*2*Math.PI
    const latitude = y/canvas.height*Math.PI
    const u = Math.cos(longitude)*Math.sin(latitude)
    const v = Math.sin(longitude)*Math.sin(latitude)
    const w = Math.cos(latitude)
    const granules = Math.sin(77*u+21*v)*Math.sin(94*w-44*v)+.55*Math.sin(180*u+63*w)*Math.cos(142*v)
    const mottling = Math.sin(24*u-15*w)*Math.cos(21*v+11*w)
    const value = granules*.11+mottling*.15
    const pixel = (y*canvas.width+x)*4
    image.data.set([255,198+value*115,101+value*120,255],pixel)
  }
  context.putImageData(image,0,0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
