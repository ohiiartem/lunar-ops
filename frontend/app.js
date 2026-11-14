/* Lunar OPS front end. Plain JS, no dependencies.
   Every number shown comes from the API; this file only formats and draws. */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DAY_MS = 86400000;
const MAX_POINTS = 5000; // API limit, used only to suggest a larger step

const state = {
  sites: [],
  res: null,      // { a: {an, ts}, b?: {an, ts}, delta?, summary? }
  pos: 0,         // current time position: fractional index into the table
  cursors: [],    // functions (pos) => void, one per drawn chart
  skyCursors: [],
  readoutK: -1,
  view: "sky",    // "sky" | "surface" | "map"
  viewKey: "a",   // scenario shown in the surface view and the 3D map
  raf: null,
  runId: 0,
};

/* ---------- API ---------- */

const ERROR_HINTS = {
  site_not_found: "Unknown site.",
  bad_params: "Please check the inputs.",
  date_out_of_range: "The period is outside the available data.",
  too_many_points: "Too many points for one request.",
  incompatible_scenarios: "Scenarios A and B do not match.",
  data_unavailable: "No data for this site yet.",
};

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : undefined);
  } catch (e) {
    throw { code: "network", message: "Cannot reach the Lunar OPS server. Is it running?" };
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    throw (data && data.error) || { code: "http_" + res.status, message: "Server returned HTTP " + res.status };
  }
  return data;
}

function showError(err) {
  const hint = ERROR_HINTS[err.code];
  const el = $("#error");
  el.textContent = (hint ? hint + " " : "") + (err.message || "Unknown error");
  el.hidden = false;
}

/* ---------- Formatting ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmtTime = (iso) => iso.slice(0, 10) + " " + iso.slice(11, 16) + " UTC";
const fmtH = (h) => h.toFixed(1) + " h";
const fmtDur = (h) => fmtH(h) + (h >= 48 ? " (about " + (h / 24).toFixed(1) + " days)" : "");
const pct = (part, whole) => (whole > 0 ? Math.round((100 * part) / whole) : 0);
const deg = (v) => v.toFixed(2) + "°";

/* Phrases for *_status, including the cases where "time to ..." is null. */
function bodyStatus(an, body) {
  const sun = body === "sun";
  const status = sun ? an.sun_status : an.earth_status;
  const toSet = sun ? an.time_to_sunset_h : an.time_to_earth_set_h;
  const toRise = sun ? an.time_to_sunrise_h : an.time_to_earth_rise_h;
  const name = sun ? "the Sun" : "Earth";
  const Name = sun ? "The Sun" : "Earth";
  const setW = sun ? "sunset" : "Earthset";
  const riseW = sun ? "sunrise" : "Earthrise";
  switch (status) {
    case "up_until_set":
      return { label: "Time to " + setW, big: fmtH(toSet), sub: Name + " is visible at the start",
        text: `At the start ${name} is visible; ${setW} comes after ${fmtDur(toSet)}.` };
    case "up_all_period":
      return { label: "Time to " + setW, big: "Never sets", sub: "in this period",
        text: `${Name} stays visible for the whole period.` };
    case "down_until_rise":
      return { label: "Time to " + riseW, big: fmtH(toRise), sub: Name + " is hidden at the start",
        text: `At the start ${name} is hidden; ${riseW} comes after ${fmtDur(toRise)}.` };
    case "down_all_period":
      return { label: "Time to " + riseW, big: "Never rises", sub: "in this period",
        text: `${Name} stays hidden for the whole period.` };
    default:
      return { label: "Status", big: "-", sub: String(status), text: "" };
  }
}

/* Plain-language conclusions, built by fixed rules from API numbers only. */
function conclusions(an) {
  const P = an.period_hours;
  const out = [
    `Potential sunlight for ${pct(an.light_hours, P)}% of this period (${fmtH(an.light_hours)} of ${fmtH(P)}).`,
    an.longest_darkness_hours > 0
      ? `The longest stretch without sunlight lasts ${fmtDur(an.longest_darkness_hours)}.`
      : "There is no stretch without potential sunlight in this period.",
    `Earth is geometrically visible for ${pct(an.earth_visible_hours, P)}% of the period (${fmtH(an.earth_visible_hours)}).`,
    an.both_hours > 0
      ? `Sunlight and Earth visibility overlap for ${fmtH(an.both_hours)}.`
      : "Potential sunlight and geometric Earth visibility never overlap in this period.",
    bodyStatus(an, "sun").text,
    bodyStatus(an, "earth").text,
  ];
  if (!an.terrain_used) out.push("Terrain is switched off: a flat horizon is assumed.");
  return out;
}

/* ---------- Glossary ---------- */

const GLOSSARY = {
  azimuth: ["Azimuth", "Compass direction along the horizon: 0° is north, 90° is east, counted clockwise."],
  altitude: ["Altitude", "How high a body is above the flat local horizontal, in degrees. Negative means below it."],
  horizon: ["Horizon (terrain)", "The outline of hills and crater rims around the site. Anything below this outline is hidden."],
  sunset: ["Sunset / Earthset", "The moment the Sun or Earth goes behind the horizon as seen from the site."],
  geometric: ["Geometric visibility", "There is a straight, unblocked line from the site to the body. It says nothing about signal quality or power."],
  limb: ["Upper limb of the Sun", "The top edge of the Sun's disc. The Sun counts as visible while this edge is above the terrain."],
};

function initGlossary() {
  $("#glossary").innerHTML = Object.values(GLOSSARY)
    .map(([term, text]) => `<dt>${esc(term)}</dt><dd>${esc(text)}</dd>`).join("");
  applyTerms(document);
}

function applyTerms(root) {
  root.querySelectorAll(".term[data-term]").forEach((el) => {
    const g = GLOSSARY[el.dataset.term];
    if (!g) return;
    el.dataset.tip = g[1];
    el.tabIndex = 0;
  });
}

/* ---------- Controls ---------- */

const siteById = (id) => state.sites.find((s) => s.id === id);

function fillSites() {
  const html = state.sites.map((s) =>
    `<option value="${esc(s.id)}">${esc(s.name)}${s.data_source === "none" ? " (no data yet)" : ""}</option>`).join("");
  $("#a-site").innerHTML = html;
  $("#b-site").innerHTML = html;
}

/* First whole UTC day inside the data range. */
function firstDate(site) {
  if (!site || !site.data_from) return "";
  const ms = Date.parse(site.data_from);
  return isoDate(Math.ceil(ms / DAY_MS) * DAY_MS);
}

function updateLimits(key, resetDate) {
  const site = siteById($(`#${key}-site`).value);
  const date = $(`#${key}-date`);
  const days = Number($("#days").value) || 1;
  const min = firstDate(site);
  const max = site && site.data_to ? isoDate(Date.parse(site.data_to) - days * DAY_MS) : "";
  date.min = min;
  date.max = max;
  if (resetDate || !date.value) date.value = min;
  const terrain = $(`#${key}-terrain`);
  terrain.disabled = !(site && site.has_terrain);
  if (terrain.disabled) terrain.checked = false;
}

function updateSiteInfo() {
  const s = siteById($("#a-site").value);
  if (!s) { $("#site-info").textContent = ""; return; }
  const range = s.data_from && s.data_to
    ? `data ${s.data_from.slice(0, 10)} to ${s.data_to.slice(0, 10)}`
    : "no data yet";
  $("#site-info").textContent =
    `Site A: ${s.name} · lat ${s.lat}°, lon ${s.lon}° · ${range} · source: ${s.source}`;
}

/* Suggest a step that fits the API point limit (the server still validates). */
function updateStepHint() {
  const days = Number($("#days").value) || 0;
  const step = Number($("#step").value);
  const hint = $("#step-hint");
  if ((days * 1440) / step > MAX_POINTS) {
    const fit = [...$("#step").options].map((o) => Number(o.value)).find((v) => (days * 1440) / v <= MAX_POINTS);
    if (fit) {
      $("#step").value = String(fit);
      hint.textContent = `Step raised to ${fit} min to keep the request under ${MAX_POINTS} points.`;
      hint.hidden = false;
      return;
    }
  }
  hint.hidden = true;
}

function scenario(key) {
  return {
    site_id: $(`#${key}-site`).value,
    start: $(`#${key}-date`).value + "T00:00:00Z",
    days: Number($("#days").value),
    step_min: Number($("#step").value),
    use_terrain: $(`#${key}-terrain`).checked,
  };
}

function setCompare(on) {
  $("#compare-toggle").checked = on;
  $("#b-fields").hidden = !on;
  if (on && !$("#b-date").value) {
    $("#b-site").value = $("#a-site").value;
    updateLimits("b", true);
    $("#b-date").value = $("#a-date").value;
    $("#b-terrain").checked = $("#a-terrain").checked;
  }
}

/* Mission Shift: B = A, start moved by N days. */
function missionShift(n) {
  const aDate = $("#a-date").value;
  if (!aDate) { showError({ message: "Pick a start date for scenario A first." }); return; }
  setCompare(true);
  $("#b-site").value = $("#a-site").value;
  updateLimits("b", false);
  $("#b-date").value = isoDate(Date.parse(aDate + "T00:00:00Z") + n * DAY_MS);
  $("#b-terrain").checked = $("#a-terrain").checked;
  run();
}

function setLevel(level) {
  document.body.classList.toggle("simple", level === "simple");
  document.body.classList.toggle("expert", level === "expert");
  $("#level-simple").setAttribute("aria-pressed", String(level === "simple"));
  $("#level-expert").setAttribute("aria-pressed", String(level === "expert"));
  if (state.res) { updateReadout(); refreshView(); writeUrl(); }
}
const isExpert = () => document.body.classList.contains("expert");

/* ---------- Shareable URL ---------- */

function writeUrl() {
  const a = scenario("a");
  const q = new URLSearchParams({
    site: a.site_id, start: a.start.slice(0, 10), days: a.days, step: a.step_min,
    terrain: a.use_terrain ? 1 : 0, level: isExpert() ? "expert" : "simple",
  });
  if ($("#compare-toggle").checked) {
    const b = scenario("b");
    q.set("bsite", b.site_id); q.set("bstart", b.start.slice(0, 10)); q.set("bterrain", b.use_terrain ? 1 : 0);
  }
  history.replaceState(null, "", "?" + q.toString());
}

function readUrl() {
  const q = new URLSearchParams(location.search);
  const has = (k) => q.get(k) !== null && q.get(k) !== "";
  if (has("level")) setLevel(q.get("level") === "expert" ? "expert" : "simple");
  if (has("days")) $("#days").value = q.get("days");
  if (has("step") && [...$("#step").options].some((o) => o.value === q.get("step"))) $("#step").value = q.get("step");
  if (has("site") && siteById(q.get("site"))) $("#a-site").value = q.get("site");
  updateLimits("a", true);
  if (has("start")) $("#a-date").value = q.get("start");
  if (has("terrain") && !$("#a-terrain").disabled) $("#a-terrain").checked = q.get("terrain") === "1";
  if (has("bsite") && siteById(q.get("bsite")) && has("bstart")) {
    setCompare(true);
    $("#b-site").value = q.get("bsite");
    updateLimits("b", false);
    $("#b-date").value = q.get("bstart");
    if (has("bterrain") && !$("#b-terrain").disabled) $("#b-terrain").checked = q.get("bterrain") === "1";
  }
}

/* ---------- Run ---------- */

function setBusy(busy) {
  $("#loading").hidden = !busy;
  $("#analyze").disabled = busy;
  document.querySelectorAll("[data-shift]").forEach((b) => { b.disabled = busy; });
}

async function run() {
  const id = ++state.runId;
  stopPlay();
  $("#error").hidden = true;
  $("#empty").hidden = true;
  const cmp = $("#compare-toggle").checked;
  if (!$("#a-date").value || (cmp && !$("#b-date").value)) {
    showError({ message: "Pick a start date." });
    return;
  }
  const a = scenario("a");
  const b = cmp ? scenario("b") : null;
  setBusy(true);
  try {
    const [sum, tsA, tsB] = await Promise.all([
      cmp ? api("/api/compare", { a, b }) : api("/api/analyze", a),
      api("/api/timeseries", a),
      cmp ? api("/api/timeseries", b) : null,
    ]);
    if (id !== state.runId) return;
    state.res = cmp
      ? { a: { an: sum.a, ts: tsA }, b: { an: sum.b, ts: tsB }, delta: sum.delta, summary: sum.summary }
      : { a: { an: sum, ts: tsA } };
    state.pos = 0;
    render();
    writeUrl();
  } catch (err) {
    if (id !== state.runId) return;
    state.res = null;
    $("#results").hidden = true;
    showError(err);
  } finally {
    if (id === state.runId) setBusy(false);
  }
}

const keys = () => (state.res && state.res.b ? ["a", "b"] : ["a"]);

function updateBanner() {
  const demo = state.sites.some((s) => s.data_source === "synthetic_demo") ||
    (state.res && keys().some((k) =>
      state.res[k].an.data_source === "synthetic_demo" || state.res[k].ts.data_source === "synthetic_demo"));
  $("#demo-banner").hidden = !demo;
}

/* ---------- Summary (conclusions, cards, deltas) ---------- */

function card(cls, label, big, sub) {
  return `<div class="card ${cls}"><div class="label">${label}</div><div class="big">${esc(big)}</div><div class="sub">${esc(sub)}</div></div>`;
}

function scenarioBox(key) {
  const an = state.res[key].an;
  const site = siteById(an.site_id);
  const P = an.period_hours;
  const sun = bodyStatus(an, "sun");
  const earth = bodyStatus(an, "earth");
  const badge = state.res.b ? `<span class="badge badge-${key}">${key.toUpperCase()}</span> ` : "";
  return `
    <section class="scn-box ${state.res.b ? "key-" + key : ""}">
      <h2>${badge}${esc(site ? site.name : an.site_id)}</h2>
      <p class="scn-meta">From ${esc(fmtTime(an.start))} · ${an.days} days (${fmtH(P)}) · step ${an.step_min} min ·
        terrain ${an.terrain_used ? "on" : "off (flat horizon)"}<span class="xo"> · data source: ${esc(an.data_source)}</span></p>
      <ul class="conclusions">${conclusions(an).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      <div class="cards">
        ${card("c-sun", "Potential sunlight", fmtH(an.light_hours), `${pct(an.light_hours, P)}% of the period`)}
        ${card("c-earth", '<span class="term" data-term="geometric">Geometric Earth visibility</span>', fmtH(an.earth_visible_hours), `${pct(an.earth_visible_hours, P)}% of the period`)}
        ${card("c-both", "Sun + Earth together", fmtH(an.both_hours), `${pct(an.both_hours, P)}% of the period`)}
        ${card("c-dark", "Longest darkness", fmtH(an.longest_darkness_hours), an.longest_darkness_hours >= 48 ? `about ${(an.longest_darkness_hours / 24).toFixed(1)} days` : "without potential sunlight")}
        ${card("c-sun", `<span class="term" data-term="sunset">${esc(sun.label)}</span>`, sun.big, sun.sub)}
        ${card("c-earth", `<span class="term" data-term="sunset">${esc(earth.label)}</span>`, earth.big, earth.sub)}
      </div>
    </section>`;
}

const DELTAS = [
  { k: "light_hours", label: "Potential sunlight", up: "more", down: "less", goodUp: true },
  { k: "earth_visible_hours", label: "Geometric Earth visibility", up: "more", down: "less", goodUp: true },
  { k: "both_hours", label: "Sun + Earth together", up: "more", down: "less", goodUp: true },
  { k: "longest_darkness_hours", label: "Longest darkness", up: "longer", down: "shorter", goodUp: false },
];

function deltaBox() {
  const d = state.res.delta;
  const cards = DELTAS.map((def) => {
    const v = d[def.k];
    if (v === 0) return card("", def.label, "= 0.0 h", "no change");
    const good = (v > 0) === def.goodUp;
    const big = (v > 0 ? "▲ +" : "▼ −") + Math.abs(v).toFixed(1) + " h";
    return card(good ? "d-good" : "d-bad", def.label, big, `B is ${v > 0 ? def.up : def.down} than A`);
  }).join("");
  return `
    <section class="panel delta">
      <h2>Difference: <span class="badge badge-b">B</span> minus <span class="badge badge-a">A</span></h2>
      <p class="server-summary">${esc(state.res.summary)}</p>
      <div class="cards">${cards}</div>
    </section>`;
}

function renderSummary() {
  const el = $("#summary");
  el.innerHTML =
    `<div class="scn-cols ${state.res.b ? "two" : ""}">${keys().map(scenarioBox).join("")}</div>` +
    (state.res.b ? deltaBox() : "");
  applyTerms(el);
}

/* ---------- Chart helpers ---------- */

function minMax(arrays) {
  let lo = Infinity, hi = -Infinity;
  for (const arr of arrays) for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

function niceTicks(lo, hi, maxN) {
  const step = [0.5, 1, 2, 5, 10, 20, 45, 90].find((s) => (hi - lo) / s <= maxN) || 90;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 10) / 10);
  return out;
}

/* Tick positions in hours from the start of the period. */
function hourTicks(hours, maxN) {
  const step = [1, 2, 3, 6, 12, 24, 48, 120, 240, 480, 720, 1440, 2160].find((s) => hours / s <= maxN) || 2160;
  const out = [];
  for (let h = 0; h <= hours + 1e-9; h += step) out.push(h);
  return { step, out };
}

function dateLabel(ms, stepH) {
  const d = new Date(ms);
  const day = MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  if (stepH >= 24) return day;
  const hh = String(d.getUTCHours()).padStart(2, "0") + ":00";
  return d.getUTCHours() === 0 ? day : hh;
}

function chartBlock(parent, key, title) {
  const block = document.createElement("div");
  block.className = "chart-block";
  const badge = state.res.b && key ? `<span class="badge badge-${key}">${key.toUpperCase()}</span> ` : "";
  block.innerHTML = (badge || title ? `<div class="chart-title">${badge}${esc(title)}</div>` : "") + `<div class="chart"></div>`;
  parent.appendChild(block);
  return $(".chart", block);
}

/* ---------- Time model ----------
   state.pos is a fractional index into the timeseries table. Markers move along the table
   values with linear interpolation between rows; visibility flags are taken from the nearest row. */

function sampleAt(ts, pos) {
  const n = ts.t.length;
  pos = Math.max(0, Math.min(pos, n - 1));
  const i = Math.floor(pos), j = Math.min(i + 1, n - 1), f = pos - i, k = Math.round(pos);
  const lerp = (a) => a[i] + (a[j] - a[i]) * f;
  const lerpAz = (a) => {
    let d = a[j] - a[i];
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return (((a[i] + d * f) % 360) + 360) % 360;
  };
  return {
    k,
    sunAz: lerpAz(ts.sun_az), sunAlt: lerp(ts.sun_alt), sunVis: ts.sun_visible[k],
    earthAz: lerpAz(ts.earth_az), earthAlt: lerp(ts.earth_alt), earthVis: ts.earth_visible[k],
  };
}

const stepMin = () => state.res.a.an.step_min;
const maxPos = () => Math.min(...keys().map((k) => state.res[k].ts.t.length)) - 1;
const viewTs = () => (state.res ? (state.res[state.viewKey] || state.res.a).ts : null);

/* Sky panorama can overlay A and B when both look at the same horizon. */
const canOverlay = () => !!(state.res && state.res.b &&
  state.res.a.an.site_id === state.res.b.an.site_id &&
  state.res.a.an.terrain_used === state.res.b.an.terrain_used);

/* ---------- Sky panorama ---------- */

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];

/* list = [{key, ts}] - one entry, or two entries drawn as an overlay (B in its own color). */
function drawPanorama(el, list) {
  const overlay = list.length > 1;
  const ts0 = list[0].ts;
  const W = Math.max(300, el.clientWidth);
  const narrow = W < 640;
  const H = narrow ? 300 : Math.min(460, Math.round(W * 0.36));
  const m = { l: narrow ? 44 : 60, r: 12, t: 14, b: 44 };
  const hz = ts0.horizon || null;
  const [lo, hi] = minMax([...list.flatMap((e) => [e.ts.sun_alt, e.ts.earth_alt]), hz ? hz.horizon_deg : [0]]);
  const y0 = lo - 1, y1 = hi + 1;
  const x = (az) => m.l + (az / 360) * (W - m.l - m.r);
  const y = (v) => m.t + ((y1 - v) / (y1 - y0)) * (H - m.t - m.b);
  const bottom = H - m.b;
  const fs = narrow ? 13 : 16;
  let s = `<svg class="pano" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sky panorama: Sun and Earth tracks above the terrain horizon">`;
  s += `<rect width="${W}" height="${H}" fill="#02040a"/>`;

  for (const v of niceTicks(y0, y1, narrow ? 5 : 8)) {
    s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text class="tick xo" x="${m.l - 6}" y="${y(v) + 5}" text-anchor="end" font-size="${fs}">${v}°</text>`;
  }
  COMPASS.forEach((name, k) => {
    if (narrow && k % 2) return;
    const X = x(k * 45);
    s += `<line class="grid" x1="${X}" x2="${X}" y1="${m.t}" y2="${bottom}"/>`;
    s += `<text class="tick" x="${X}" y="${bottom + fs + 4}" text-anchor="${k === 0 ? "start" : k === 8 ? "end" : "middle"}" font-size="${fs}" font-weight="700">${name}</text>`;
  });
  s += `<text class="axis-title xo" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle" font-size="${fs - 2}">Azimuth (compass direction)</text>`;
  s += `<text class="axis-title" transform="translate(${narrow ? 12 : 16},${(m.t + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="${fs - 2}">Height above horizon</text>`;

  // terrain silhouette (or flat ground when there is no terrain profile)
  if (hz) {
    let d = "";
    hz.azimuth_deg.forEach((a, k) => { d += (k ? "L" : "M") + x(a).toFixed(1) + "," + y(hz.horizon_deg[k]).toFixed(1); });
    if (hz.azimuth_deg[hz.azimuth_deg.length - 1] < 360) d += "L" + x(360).toFixed(1) + "," + y(hz.horizon_deg[0]).toFixed(1);
    d += `L${x(360)},${bottom}L${x(0)},${bottom}Z`;
    s += `<path class="terrain" d="${d}"/>`;
  } else {
    s += `<rect class="terrain" x="${m.l}" y="${y(0)}" width="${W - m.l - m.r}" height="${bottom - y(0)}"/>`;
  }
  s += `<line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  s += `<text class="tick so" x="${m.l - 6}" y="${y(0) + 5}" text-anchor="end" font-size="${fs}">0°</text>`;
  s += `<text class="terrain-label" x="${m.l + 8}" y="${bottom - 8}" font-size="${fs - 2}">${hz ? "Terrain (blocks the sky)" : "Terrain: none (flat horizon)"}</text>`;
  s += `<text class="note" x="${W - m.r - 8}" y="${m.t + fs + 2}" text-anchor="end" font-size="${fs - 2}">Vertical scale is exaggerated</text>`;

  // tracks: thin line + dots (solid = visible, hollow = hidden). Scenario B in overlay: dashed line in the B color.
  const track = (ts, body, isB) => {
    const az = ts[body + "_az"], alt = ts[body + "_alt"], vis = ts[body + "_visible"];
    const n = az.length;
    const stride = Math.max(1, Math.ceil(n / (narrow ? 240 : 480)));
    let d = "", dots = "";
    for (let i = 0; i < n; i++) {
      const X = x(az[i]), Y = y(alt[i]);
      d += (i === 0 || Math.abs(az[i] - az[i - 1]) > 180 ? "M" : "L") + X.toFixed(1) + "," + Y.toFixed(1);
      if (isB || i % stride) continue;
      const cls = `dot ${body} ${vis[i] ? "on" : "off"}`;
      dots += body === "sun"
        ? `<circle class="${cls}" cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="3"/>`
        : `<rect class="${cls}" x="${(X - 3).toFixed(1)}" y="${(Y - 3).toFixed(1)}" width="6" height="6"/>`;
    }
    return `<path class="track ${body}${isB ? " scn-b" : ""}" d="${d}"/>` + dots;
  };
  list.forEach((e, idx) => {
    s += track(e.ts, "earth", overlay && idx === 1);
    s += track(e.ts, "sun", overlay && idx === 1);
  });

  // big moving markers
  list.forEach((e, idx) => {
    const tag = overlay ? " " + e.key.toUpperCase() : "";
    const cls = overlay && idx === 1 ? " scn-b" : "";
    s += `<g class="marker earth${cls}" data-m="earth-${idx}"><rect class="shape" x="-10" y="-10" width="20" height="20"/><text font-size="${fs}">Earth${tag}</text></g>`;
    s += `<g class="marker sun${cls}" data-m="sun-${idx}"><circle class="shape" r="12"/><text font-size="${fs}">Sun${tag}</text></g>`;
  });
  s += `</svg>`;
  el.innerHTML = s;

  const place = (g, az, alt, vis, dy) => {
    const X = x(az), Y = y(alt), flip = X > W - 120;
    g.setAttribute("transform", `translate(${X.toFixed(1)},${Y.toFixed(1)})`);
    g.classList.toggle("off", !vis);
    const t = $("text", g);
    t.setAttribute("x", flip ? -18 : 18);
    t.setAttribute("y", dy);
    t.setAttribute("text-anchor", flip ? "end" : "start");
  };
  const marks = list.map((e, idx) => ({
    ts: e.ts, sun: $(`[data-m="sun-${idx}"]`, el), earth: $(`[data-m="earth-${idx}"]`, el), up: idx === 0,
  }));
  return (pos) => {
    for (const mk of marks) {
      const p = sampleAt(mk.ts, pos);
      place(mk.sun, p.sunAz, p.sunAlt, p.sunVis, mk.up ? -10 : 24);
      place(mk.earth, p.earthAz, p.earthAlt, p.earthVis, mk.up ? -10 : 24);
    }
  };
}

function skyLegend(overlay) {
  const sw = (inner) => `<svg width="18" height="18">${inner}</svg>`;
  const items = [
    [sw(`<circle cx="9" cy="9" r="6" fill="#ffb000"/>`), "Sun visible"],
    [sw(`<circle cx="9" cy="9" r="5" fill="none" stroke="#ffb000" stroke-width="2"/>`), "Sun hidden"],
    [sw(`<rect x="3" y="3" width="12" height="12" fill="#56b4e9"/>`), "Earth visible"],
    [sw(`<rect x="4" y="4" width="10" height="10" fill="none" stroke="#56b4e9" stroke-width="2"/>`), "Earth hidden"],
    [sw(`<rect width="18" height="18" fill="#6b7280"/>`), "Terrain"],
  ];
  if (overlay) {
    items.push([`<svg width="30" height="18"><line x1="1" y1="9" x2="29" y2="9" stroke="#b79cff" stroke-width="3" stroke-dasharray="7 5"/></svg>`,
      "Scenario B tracks (circle = Sun, square = Earth)"]);
  }
  $("#sky-legend").innerHTML = items.map(([icon, text]) => `<li>${icon} ${text}</li>`).join("");
}

/* Click or drag on a chart to move the time cursor. frac01 -> position. */
function makeSeekable(el, W, left, right, toPos) {
  const svg = $("svg", el);
  const seek = (e) => {
    if (e.type === "pointermove" && !(e.buttons & 1)) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const f = Math.max(0, Math.min(1, (px - left) / (W - left - right)));
    stopPlay();
    setPos(toPos(f));
  };
  svg.addEventListener("pointerdown", seek);
  svg.addEventListener("pointermove", seek);
}

/* ---------- Altitude over time ---------- */

function drawAltChart(el, ts, body) {
  const alt = ts[body + "_alt"], hor = ts[body + "_horizon"], vis = ts[body + "_visible"];
  const name = body === "sun" ? "Sun" : "Earth";
  const W = Math.max(300, el.clientWidth);
  const narrow = W < 640;
  const H = narrow ? 200 : 230;
  const m = { l: narrow ? 44 : 60, r: 12, t: 26, b: 30 };
  const n = alt.length;
  const t0 = Date.parse(ts.t[0]), t1 = Date.parse(ts.t[n - 1]);
  const [lo, hi] = minMax([alt, hor, [0]]);
  const y0 = lo - 0.5, y1 = hi + 0.5;
  const x = (i) => m.l + (n > 1 ? i / (n - 1) : 0) * (W - m.l - m.r);
  const y = (v) => m.t + ((y1 - v) / (y1 - y0)) * (H - m.t - m.b);
  const bottom = H - m.b;
  const fs = narrow ? 12 : 15;
  let s = `<svg class="plot" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${name} altitude and terrain horizon over time">`;
  s += `<rect class="frame" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${bottom - m.t}"/>`;

  // shaded spans where the body is visible (booleans from the API)
  for (let i = 0; i < n; i++) {
    if (!vis[i]) continue;
    let j = i;
    while (j + 1 < n && vis[j + 1]) j++;
    s += `<rect class="span ${body}" x="${x(i).toFixed(1)}" y="${m.t}" width="${Math.max(1, x(j) - x(i)).toFixed(1)}" height="${bottom - m.t}"/>`;
    i = j;
  }
  for (const v of niceTicks(y0, y1, 5)) {
    s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text class="tick xo" x="${m.l - 6}" y="${y(v) + 5}" text-anchor="end" font-size="${fs}">${v}°</text>`;
  }
  s += `<line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  const hours = (t1 - t0) / 3600000;
  const tk = hourTicks(hours, narrow ? 4 : 10);
  for (const h of tk.out) {
    const X = m.l + (hours > 0 ? h / hours : 0) * (W - m.l - m.r);
    s += `<line class="grid" x1="${X}" x2="${X}" y1="${bottom}" y2="${bottom + 5}"/>`;
    s += `<text class="tick" x="${X}" y="${bottom + fs + 6}" text-anchor="middle" font-size="${fs}">${dateLabel(t0 + h * 3600000, tk.step)}</text>`;
  }
  const line = (arr) => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join("");
  s += `<path class="hz" d="${line(hor)}"/>`;
  s += `<path class="alt ${body}" d="${line(alt)}"/>`;
  s += `<text class="inline-label" x="${m.l}" y="${m.t - 8}" font-size="${fs}" fill="${body === "sun" ? "#ffb000" : "#56b4e9"}">━━ ${name} altitude</text>`;
  s += `<text class="inline-label" x="${m.l + (narrow ? 150 : 190)}" y="${m.t - 8}" font-size="${fs}" fill="#eef1f7">┅┅ terrain in ${name === "Sun" ? "the Sun's" : "Earth's"} direction</text>`;
  s += `<line class="cursor" y1="${m.t}" y2="${bottom}"/></svg>`;
  el.innerHTML = s;
  makeSeekable(el, W, m.l, m.r, (f) => f * (n - 1));
  const cur = $(".cursor", el);
  return (pos) => {
    const X = x(Math.min(pos, n - 1)).toFixed(1);
    cur.setAttribute("x1", X); cur.setAttribute("x2", X);
  };
}

/* ---------- Timeline strip ---------- */

function drawTimeline(el, an) {
  const W = Math.max(300, el.clientWidth);
  const narrow = W < 640;
  const rows = [
    { key: "light_windows", cls: "bar-sun", label: narrow ? "Sun" : "Potential sunlight" },
    { key: "earth_windows", cls: "bar-earth", label: narrow ? "Earth" : "Earth visible" },
    { key: "both_windows", cls: "bar-both", label: "Both" },
  ];
  const rowH = 26, gap = 8;
  const m = { l: narrow ? 60 : 180, r: 12, t: 6, b: 30 };
  const H = m.t + rows.length * (rowH + gap) + m.b;
  const t0 = Date.parse(an.start), hours = an.period_hours;
  const x = (ms) => m.l + Math.min(1, Math.max(0, (ms - t0) / (hours * 3600000))) * (W - m.l - m.r);
  const fs = narrow ? 12 : 15;
  let s = `<svg class="plot" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Timeline of potential sunlight, geometric Earth visibility and both">`;
  s += `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="8" fill="#000" fill-opacity="0.35"/></pattern>`;
  s += `<pattern id="dots" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.6" fill="#000" fill-opacity="0.5"/></pattern></defs>`;
  rows.forEach((r, k) => {
    const Y = m.t + k * (rowH + gap);
    s += `<text class="row-label" x="${m.l - 8}" y="${Y + rowH / 2 + 5}" text-anchor="end" font-size="${fs}">${r.label}</text>`;
    s += `<rect class="row-bg" x="${m.l}" y="${Y}" width="${W - m.l - m.r}" height="${rowH}"/>`;
    for (const w of an[r.key]) {
      const X0 = x(Date.parse(w.from)), X1 = x(Date.parse(w.to));
      const wd = Math.max(1.5, X1 - X0).toFixed(1);
      s += `<rect class="${r.cls}" x="${X0.toFixed(1)}" y="${Y}" width="${wd}" height="${rowH}"/>`;
      if (k === 1) s += `<rect fill="url(#hatch)" x="${X0.toFixed(1)}" y="${Y}" width="${wd}" height="${rowH}"/>`;
      if (k === 2) s += `<rect fill="url(#dots)" x="${X0.toFixed(1)}" y="${Y}" width="${wd}" height="${rowH}"/>`;
    }
  });
  const axisY = m.t + rows.length * (rowH + gap);
  const tk = hourTicks(hours, narrow ? 4 : 10);
  for (const h of tk.out) {
    const X = x(t0 + h * 3600000);
    s += `<line class="zero" x1="${X}" x2="${X}" y1="${axisY - gap}" y2="${axisY}"/>`;
    s += `<text class="tick" x="${X}" y="${axisY + fs + 2}" text-anchor="${X > W - 40 ? "end" : "middle"}" font-size="${fs}">${h} h</text>`;
  }
  s += `<line class="cursor" y1="${m.t}" y2="${axisY - gap}"/></svg>`;
  el.innerHTML = s;
  makeSeekable(el, W, m.l, m.r, (f) => (f * hours * 60) / an.step_min);
  const cur = $(".cursor", el);
  return (pos) => {
    const X = x(t0 + pos * an.step_min * 60000).toFixed(1);
    cur.setAttribute("x1", X); cur.setAttribute("x2", X);
  };
}

/* ---------- Time controls, readout, play ---------- */

function dial(ts, k) {
  const c = 40, R = 30;
  const needle = (az, cls) => {
    const a = (az * Math.PI) / 180;
    return `<line class="${cls}" x1="${c}" y1="${c}" x2="${(c + R * Math.sin(a)).toFixed(1)}" y2="${(c - R * Math.cos(a)).toFixed(1)}"/>`;
  };
  return `<svg class="dial" width="80" height="80" viewBox="0 0 80 80" role="img" aria-label="Compass: directions to the Sun and Earth">
    <circle cx="${c}" cy="${c}" r="${R}"/>
    <text x="${c}" y="9" text-anchor="middle">N</text><text x="${c}" y="79" text-anchor="middle">S</text>
    <text x="76" y="44" text-anchor="middle">E</text><text x="5" y="44" text-anchor="middle">W</text>
    ${needle(ts.earth_az[k], "n-earth")}${needle(ts.sun_az[k], "n-sun")}</svg>`;
}

function bodyReadout(ts, i, body) {
  const name = body === "sun" ? "Sun" : "Earth";
  const alt = ts[body + "_alt"][i], az = ts[body + "_az"][i], hor = ts[body + "_horizon"][i];
  const vis = ts[body + "_visible"][i];
  // Wording rule: hidden while above the flat horizontal (terrain on) = behind terrain.
  const why = vis ? "visible" : (ts.terrain_used && alt > 0 ? "hidden behind terrain" : "below the horizon");
  let s = `<div>${name}: <span class="${vis ? "st-on" : "st-off"}">${vis ? "●" : "○"} ${why}</span>`;
  if (isExpert()) s += ` · alt ${deg(alt)} · az ${deg(az)} · terrain ${deg(hor)}`;
  return s + "</div>";
}

function updateReadout() {
  $("#readout").innerHTML = keys().map((k) => {
    const ts = state.res[k].ts;
    const i = Math.min(Math.round(state.pos), ts.t.length - 1);
    const badge = state.res.b ? `<span class="badge badge-${k}">${k.toUpperCase()}</span> ` : "";
    return `<div class="ro">${dial(ts, i)}<div>${badge}<span class="time">${esc(fmtTime(ts.t[i]))}</span>${bodyReadout(ts, i, "sun")}${bodyReadout(ts, i, "earth")}</div></div>`;
  }).join("");
  state.readoutK = Math.round(state.pos);
}

function refreshView() {
  if (state.view === "surface") SurfaceView.draw();
  if (state.view === "map") MapView.update();
}

function setPos(pos) {
  const max = maxPos();
  state.pos = Math.max(0, Math.min(pos, max));
  const minutes = state.pos * stepMin();
  const day = Math.min(Number($("#day").max), Math.floor(minutes / 1440));
  const todStep = Number($("#tod").step);
  const tod = Math.floor((minutes - day * 1440) / todStep) * todStep;
  $("#day").value = String(day);
  $("#tod").value = String(tod);
  const ms = Date.parse(state.res.a.an.start) + minutes * 60000;
  const d = new Date(ms);
  $("#day-out").textContent = `Day ${day + 1} of ${state.res.a.an.days}` + (state.res.b ? "" : ` · ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`);
  $("#tod-out").textContent = `${String(Math.floor(tod / 60)).padStart(2, "0")}:${String(tod % 60).padStart(2, "0")}` + " UTC";
  for (const fn of state.cursors) fn(state.pos);
  if (Math.round(state.pos) !== state.readoutK) updateReadout();
  refreshView();
}

function sliderInput() {
  stopPlay();
  setPos((Number($("#day").value) * 1440 + Number($("#tod").value)) / stepMin());
}

function stopPlay() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = null;
  $("#play").innerHTML = "&#9654; Play";
}

function togglePlay() {
  if (state.raf) { stopPlay(); return; }
  if (!state.res) return;
  if (state.pos >= maxPos()) setPos(0);
  $("#play").innerHTML = "&#10074;&#10074; Pause";
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const hoursPerSec = Number($("#speed").value);
    setPos(state.pos + (hoursPerSec * dt * 60) / stepMin());
    if (state.pos >= maxPos()) { stopPlay(); return; }
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}

/* ---------- Views (tabs) ---------- */

function setView(view) {
  state.view = view;
  document.querySelectorAll(".tabs [data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  $("#view-sky").hidden = view !== "sky";
  $("#view-surface").hidden = view !== "surface";
  $("#view-map").hidden = view !== "map";
  $("#view-key").hidden = !(state.res && state.res.b) || view === "sky";
  if (!state.res) return;
  if (view === "sky") drawSky();
  if (view === "surface") SurfaceView.show();
  if (view === "map") MapView.show();
}

function setViewKey(key) {
  state.viewKey = key;
  document.querySelectorAll("#view-key [data-key]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === key)));
  if (!state.res) return;
  if (state.view === "surface") SurfaceView.show();
  if (state.view === "map") MapView.show();
}

/* ---------- Render ---------- */

function drawSky() {
  const pano = $("#panoramas");
  pano.innerHTML = "";
  state.skyCursors = [];
  if (state.view !== "sky") return;
  const overlay = canOverlay();
  const title = (k) => {
    const an = state.res[k].an, site = siteById(an.site_id);
    return `${site ? site.name : an.site_id}, from ${an.start.slice(0, 10)}`;
  };
  if (overlay) {
    const el = chartBlock(pano, null, "A and B on the same sky");
    state.skyCursors.push(drawPanorama(el, keys().map((k) => ({ key: k, ts: state.res[k].ts }))));
  } else {
    for (const k of keys()) {
      state.skyCursors.push(drawPanorama(chartBlock(pano, k, state.res.b ? title(k) : ""), [{ key: k, ts: state.res[k].ts }]));
    }
  }
  skyLegend(overlay);
  for (const fn of state.skyCursors) fn(state.pos);
}

function drawCharts() {
  state.cursors = [(pos) => { for (const fn of state.skyCursors) fn(pos); }];
  const alts = $("#altcharts"), tls = $("#timelines");
  alts.innerHTML = tls.innerHTML = "";
  drawSky();
  for (const k of keys()) {
    const { an, ts } = state.res[k];
    const site = siteById(an.site_id);
    const title = state.res.b ? `${site ? site.name : an.site_id}, from ${an.start.slice(0, 10)}` : "";
    state.cursors.push(drawAltChart(chartBlock(alts, k, title), ts, "sun"));
    state.cursors.push(drawAltChart(chartBlock(alts, k, ""), ts, "earth"));
    state.cursors.push(drawTimeline(chartBlock(tls, k, title), an));
  }
  $("#day").max = String(state.res.a.an.days - 1);
  const todStep = Math.min(stepMin(), 15);
  $("#tod").step = String(todStep);
  $("#tod").max = String(1440 - todStep);
  state.readoutK = -1;
  setPos(state.pos);
}

function render() {
  updateBanner();
  $("#results").hidden = false;
  if (!state.res.b) state.viewKey = "a";
  setViewKey(state.viewKey);
  renderSummary();
  SurfaceView.reset();
  drawCharts();
  setView(state.view);
}

/* ---------- Init ---------- */

async function init() {
  initGlossary();
  $("#controls").noValidate = true;
  $("#controls").addEventListener("submit", (e) => { e.preventDefault(); run(); });
  $("#a-site").addEventListener("change", () => { updateLimits("a", true); updateSiteInfo(); });
  $("#b-site").addEventListener("change", () => updateLimits("b", true));
  $("#days").addEventListener("change", () => { updateStepHint(); updateLimits("a", false); updateLimits("b", false); });
  $("#step").addEventListener("change", updateStepHint);
  $("#compare-toggle").addEventListener("change", (e) => setCompare(e.target.checked));
  document.querySelectorAll("[data-shift]").forEach((b) =>
    b.addEventListener("click", () => missionShift(Number(b.dataset.shift))));
  $("#level-simple").addEventListener("click", () => setLevel("simple"));
  $("#level-expert").addEventListener("click", () => setLevel("expert"));
  $("#day").addEventListener("input", sliderInput);
  $("#tod").addEventListener("input", sliderInput);
  $("#play").addEventListener("click", togglePlay);
  document.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => {
    if (!state.res) return;
    stopPlay();
    setPos(state.pos + (Number(b.dataset.jump) * 1440) / stepMin());
  }));
  document.querySelectorAll(".tabs [data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  document.querySelectorAll("#view-key [data-key]").forEach((b) => b.addEventListener("click", () => setViewKey(b.dataset.key)));
  SurfaceView.init($("#surface"));
  MapView.init($("#map3d"));
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.res) return;
      drawCharts();
      if (state.view === "surface") SurfaceView.show();
      if (state.view === "map") MapView.show();
    }, 150);
  });

  setBusy(true);
  try {
    state.sites = (await api("/api/sites")).sites || [];
  } catch (err) {
    setBusy(false);
    $("#empty").hidden = true;
    showError(err);
    return;
  }
  setBusy(false);
  updateBanner();
  if (!state.sites.length) {
    $("#empty").textContent = "No sites are available from the server.";
    return;
  }
  fillSites();
  updateLimits("a", true);
  readUrl();
  updateSiteInfo();
  if ($("#a-date").value) run(); // first end-to-end view with the defaults (or the shared URL)
}

init();
