// How long until the visibility flag changes, counted from the observation time on the timeline.
// Uses only the flags returned by the API (sun_visible / earth_visible / both_visible), one flag per time step.

export interface Countdown {
  visible: boolean
  steps: number | null // steps until the first change after `index`; null = no change before the end of the period
  atIndex: number | null // index of the first sample with the other state
}

export function nextChange(flags: boolean[], index: number): Countdown {
  const visible = flags[index]
  for (let j = index + 1; j < flags.length; j++) {
    if (flags[j] !== visible) return { visible, steps: j - index, atIndex: j }
  }
  return { visible, steps: null, atIndex: null }
}

export function formatDuration(hours: number) {
  const minutes = Math.round(hours * 60)
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`
  return `${m} min`
}

export interface CountdownLabels { ending: string; starting: string; stays: string; stayed: string }

// Text for one countdown: a label ("Sunset in") and the time left, shown in a box. No dates.
export function describe(flags: boolean[], index: number, stepMin: number, labels: CountdownLabels) {
  const c = nextChange(flags, index)
  if (c.steps === null) {
    const left = (flags.length - 1 - index) * stepMin / 60
    return { label: `${c.visible ? labels.stays : labels.stayed} until the end of the period`, time: `${formatDuration(left)} left` }
  }
  return { label: `${c.visible ? labels.ending : labels.starting} in`, time: formatDuration(c.steps * stepMin / 60) }
}

export function countdownHtml(item: { label: string; time: string }) {
  return `<span class="countdown-label">${item.label}</span><span class="countdown-time">${item.time}</span>`
}

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// "28 Nov 12:40 → 23:50 · 11 h 10 min" (UTC; the date of the end is shown only if it differs from the start)
export function formatWindow(from: string, to: string) {
  const a = new Date(from), b = new Date(to)
  const day = (d: Date) => `${d.getUTCDate()} ${months[d.getUTCMonth()]}`
  const time = (d: Date) => d.toISOString().slice(11, 16)
  const end = day(a) === day(b) ? time(b) : `${day(b)} ${time(b)}`
  return `${day(a)} ${time(a)} → ${end} · ${formatDuration((b.getTime() - a.getTime()) / 3_600_000)}`
}
