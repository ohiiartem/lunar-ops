import { colors, names, targets } from './model'
import type { Observations } from './model'

const width = 680, height = 146, left = 34, right = 650
const x = (i:number, count:number) => left + (right-left)*i/Math.max(1,count-1)

export function updateAnalysisCursor(data: Observations, index: number) {
  const position = x(index,data.times.length)
  document.querySelectorAll('#timeline [data-cursor]').forEach(cursor => {
    cursor.setAttribute('transform',`translate(${position} 0)`)
  })
}

export function renderAnalysis(data: Observations, select: (i: number) => void) {
  const timeline = document.getElementById('timeline')!
  const at = (i:number) => x(i,data.times.length)
  const windows = (isVisible:(i:number)=>boolean, y:number, height:number, color:string, opacity:number) => {
    let start: number|undefined
    const rectangles = []
    for (let i=0;i<=data.times.length;i++) {
      if (i<data.times.length && isVisible(i)) { start ??= i; continue }
      if (start===undefined) continue
      const end = at(Math.min(i,data.times.length-1))
      rectangles.push(`<rect x="${at(start)}" width="${Math.max(0,end-at(start))}" y="${y}" height="${height}" fill="${color}" opacity="${opacity}"/>`)
      start=undefined
    }
    return rectangles.join('')
  }
  timeline.innerHTML = targets.map(target => {
    const rows = data[target]
    const angles = rows.flatMap(row => row[2] === null ? [row[1]] : [row[1], row[2]])
    const low = Math.floor(Math.min(-1,...angles)), high = Math.ceil(Math.max(1,...angles))
    const y = (a:number) => 112 - (a-low)/(high-low)*94
    const path = (col:1|2) => {
      let pen = false
      return rows.map((row,i) => {
        const a = row[col]
        if (a===null) { pen=false;return '' }
        const segment = `${pen?'L':'M'}${at(i).toFixed(2)},${y(a).toFixed(2)}`
        pen=true
        return segment
      }).join(' ')
    }
    return `<figure><figcaption style="color:${colors[target]}">${names[target]}</figcaption>
      <svg viewBox="0 0 ${width} ${height}" aria-label="${names[target]} altitude and terrain horizon over time">
        ${windows(i=>rows[i][4]===1,15,99,colors[target],.15)}
        <path d="M${left},${y(0)}H${right}" stroke="#61798e"/>
        <text x="2" y="${y(0)+4}">0°</text><text x="2" y="14">${high}°</text><text x="2" y="114">${low}°</text>
        <path d="${path(1)}" fill="none" stroke="${colors[target]}" stroke-width="2"/>
        <path d="${path(2)}" fill="none" stroke="#aec0d8" stroke-dasharray="3 4"/>
        <path data-cursor d="M0,15V114" stroke="#edf4ff"/>
        <text x="${left}" y="137">${data.times[0].slice(5,10)}</text>
        <text x="${right}" y="137" text-anchor="end">${data.times.at(-1)?.slice(5,10)} UTC</text>
      </svg></figure>`
  }).join('') + `<figure class="visibility-strip"><figcaption>Terrain visibility · elapsed hours</figcaption>
    <div class="visibility-legend"><span class="sun">● Potential sunlight</span>
      <span class="earth">● Geometric Earth visibility</span><span class="both">● Both</span></div>
    <svg viewBox="0 0 ${width} 86" aria-label="Sun, Earth and simultaneous visibility over time">
      <path d="M${left},13H${right} M${left},31H${right} M${left},49H${right}" stroke="#233142" stroke-width="10"/>
      ${windows(i=>data.Sun[i][4]===1,8,10,colors.Sun,.9)}
      ${windows(i=>data.Earth[i][4]===1,26,10,colors.Earth,.9)}
      ${windows(i=>data.bothVisible?.[i] ?? (data.Sun[i][4]===1 && data.Earth[i][4]===1),44,10,'#acd9a3',.9)}
      <path data-cursor d="M0,3V59" stroke="#edf4ff"/>
      ${Array.from({length:7},(_,i)=>{
        const index = Math.round(i*(data.times.length-1)/6)
        return `<text x="${at(index)}" y="76" text-anchor="middle">${index/2} h</text>`
      }).join('')}
    </svg></figure>`
  timeline.querySelectorAll('svg').forEach(svg => {
    svg.addEventListener('click', event => {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
      select(Math.max(0,Math.min(data.times.length-1,Math.round((point.x-left)/(right-left)*(data.times.length-1)))))
    })
  })
  document.getElementById('intervals')!.innerHTML = targets.map(target => {
    const rows = data[target]
    const groups: string[] = []
    let start: number|undefined
    for (let i=0;i<=rows.length;i++) {
      if (rows[i]?.[4]===1) { start ??= i; continue }
      if (start!==undefined) {
        groups.push(`${data.times[start]} — ${data.times[i-1]} UTC`)
        start=undefined
      }
    }
    const known = rows.filter(row=>row[4]!==null)
    return `<div><h3>${names[target]}</h3><p>Visible samples · 0°: ${rows.filter(row=>row[3]===1).length}
      · LOLA: ${known.length?known.filter(row=>row[4]===1).length:'Data unavailable'}</p>
      <details><summary>Intervals from 30-minute samples</summary>${groups.length?'<ul>'+groups.map(group=>`<li>${group}</li>`).join('')+'</ul>':'<p>No visible samples.</p>'}</details></div>`
  }).join('')
}
