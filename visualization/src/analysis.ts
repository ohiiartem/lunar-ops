import { colors, names, targets } from './model'
import type { Observations } from './model'
import type { Analysis } from './sky-data'

const standardWidth = 680, height = 154, left = 34, rightMargin = 30

export function updateAnalysisCursor(timeline: HTMLElement, data: Observations, index: number) {
  timeline.querySelectorAll<SVGPathElement>('[data-cursor]').forEach(cursor => {
    const right = cursor.ownerSVGElement!.viewBox.baseVal.width - rightMargin
    const position = left + (right-left)*index/Math.max(1,data.times.length-1)
    cursor.setAttribute('transform',`translate(${position} 0)`)
  })
}

export function renderAnalysis(timeline: HTMLElement, data: Observations, metrics: Analysis, select: (i: number) => void, comparison = false) {
  const width = comparison ? 340 : standardWidth
  const right = width - rightMargin
  const stripWidth = comparison ? 440 : standardWidth
  const stripRight = stripWidth - rightMargin
  const intervals = comparison ? 4 : 6
  const at = (i:number) => left + (right-left)*i/Math.max(1,data.times.length-1)
  const start = Date.parse(metrics.start)
  const windows = (periods:Analysis['light_windows'], edge:number, y:number, height:number, color:string, opacity:number) => {
    const windowX = (time: string) => left+(edge-left)*(Date.parse(time)-start)/(metrics.period_hours*3_600_000)
    return periods.map(({from,to})=>`<rect x="${windowX(from)}" width="${windowX(to)-windowX(from)}" y="${y}" height="${height}" fill="${color}" opacity="${opacity}"/>`).join('')
  }
  timeline.innerHTML = targets.map(target => {
    const rows = data[target]
    const angles = rows.flatMap(row => [row[1],row[2]])
    const low = Math.floor(Math.min(-1,...angles)), high = Math.ceil(Math.max(1,...angles))
    const y = (a:number) => 112 - (a-low)/(high-low)*94
    const path = (col:1|2) => rows.map((row,i)=>
      `${i?'L':'M'}${at(i).toFixed(2)},${y(row[col]).toFixed(2)}`).join(' ')
    return `<figure><figcaption style="color:${colors[target]}">${names[target]}</figcaption>
      <svg viewBox="0 0 ${width} ${height}" aria-label="${names[target]} altitude and terrain horizon over time">
        ${windows(target==='Sun'?metrics.light_windows:metrics.earth_windows,right,15,99,colors[target],.15)}
        <path d="M${left},${y(0)}H${right}" stroke="#61798e"/>
        ${y(0) > 29 && y(0) < 98 ? `<text x="2" y="${y(0)+4}">0°</text>` : ''}
        <text x="2" y="14">${high}°</text><text x="2" y="114">${low}°</text>
        <path d="${path(1)}" fill="none" stroke="${colors[target]}" stroke-width="2"/>
        <path d="${path(2)}" fill="none" stroke="#aec0d8" stroke-dasharray="3 4"/>
        <path data-cursor d="M0,15V114" stroke="#edf4ff"/>
        <text x="${left}" y="137">${data.times[0].slice(5,10)}</text>
        <text x="${right}" y="137" text-anchor="end">${data.times.at(-1)?.slice(5,10)} UTC</text>
      </svg></figure>`
  }).join('') + `<figure class="visibility-strip"><figcaption>Visibility · elapsed hours</figcaption>
    <div class="visibility-legend"><span class="sun">● Potential sunlight</span>
      <span class="earth">● Geometric Earth visibility</span><span class="both">● Both</span></div>
    <svg viewBox="0 0 ${stripWidth} 86" aria-label="Sun, Earth and simultaneous visibility over time">
      <path d="M${left},13H${stripRight} M${left},31H${stripRight} M${left},49H${stripRight}" stroke="#233142" stroke-width="10"/>
      ${windows(metrics.light_windows,stripRight,8,10,colors.Sun,.9)}
      ${windows(metrics.earth_windows,stripRight,26,10,colors.Earth,.9)}
      ${windows(metrics.both_windows,stripRight,44,10,'#acd9a3',.9)}
      <path data-cursor d="M0,3V59" stroke="#edf4ff"/>
      ${Array.from({length:intervals+1},(_,i)=>{
        const elapsed = Math.round(i*metrics.period_hours/intervals)
        return `<text x="${left+(stripRight-left)*i/intervals}" y="76" text-anchor="middle">${elapsed} h</text>`
      }).join('')}
    </svg></figure>`
  timeline.querySelectorAll('svg').forEach(svg => {
    svg.addEventListener('click', event => {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse())
      const plotWidth = svg.viewBox.baseVal.width - rightMargin - left
      select(Math.max(0,Math.min(data.times.length-1,Math.round((point.x-left)/plotWidth*(data.times.length-1)))))
    })
  })
}
