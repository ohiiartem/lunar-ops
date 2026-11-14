/* Lunar OPS - extra views: "Surface view" (Canvas 2D) and "3D site map" (three.js).
   Both read the same timeseries as the 2D sky (state, sampleAt, viewTs live in app.js).
   Sun and Earth are placed at the calculated azimuth/altitude from the table. */
"use strict";

/* ---------- Surface view: 360 degree panorama from the site ---------- */

const SurfaceView = {
  FOV: 120,   // degrees across the canvas
  VEX: 4,     // vertical exaggeration, shown on screen
  canvas: null,
  yaw: 0,     // azimuth at the centre of the view
  needFace: true,
  stars: [],

  init(canvas) {
    this.canvas = canvas;
    // decorative star field, fixed pseudo-random positions (not data)
    let seed = 20261114;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 260; i++) this.stars.push({ az: rnd() * 360, f: rnd(), r: 0.5 + rnd() * 1.1, a: 0.35 + rnd() * 0.6 });

    let dragX = null;
    canvas.addEventListener("pointerdown", (e) => { dragX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (dragX === null) return;
      this.yaw = (((this.yaw - ((e.clientX - dragX) * this.FOV) / canvas.clientWidth) % 360) + 360) % 360;
      dragX = e.clientX;
      this.draw();
    });
    const end = () => { dragX = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      this.yaw = (this.yaw + (e.key === "ArrowLeft" ? -10 : 10) + 360) % 360;
      this.draw();
    });
    document.getElementById("face-sun").addEventListener("click", () => this.face("sun"));
    document.getElementById("face-earth").addEventListener("click", () => this.face("earth"));
  },

  reset() { this.needFace = true; },

  face(body) {
    const ts = viewTs();
    if (!ts) return;
    const p = sampleAt(ts, state.pos);
    this.yaw = body === "sun" ? p.sunAz : p.earthAz;
    this.draw();
  },

  show() {
    const ts = viewTs();
    if (!ts) return;
    if (this.needFace) { this.yaw = sampleAt(ts, state.pos).sunAz; this.needFace = false; }
    document.getElementById("surface-note").textContent =
      `Vertical scale is exaggerated ×${this.VEX}. The Sun and Earth discs are not to scale. The star field is decorative. ` +
      (ts.horizon
        ? "The ground is bright when the calculation marks the Sun as visible from the site and dark when it is hidden; cast shadows are not computed."
        : "Terrain: none for this scenario, so a flat horizon is shown.");
    this.draw();
  },

  draw() {
    const c = this.canvas, ts = viewTs();
    const W = c.clientWidth, H = c.clientHeight;
    if (!ts || !W || !H) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = sampleAt(ts, state.pos);
    const expert = document.body.classList.contains("expert");
    const ppd = W / this.FOV;                 // pixels per degree of azimuth
    const horizonY = H * 0.6;
    const rel = (az) => ((((az - this.yaw) % 360) + 540) % 360) - 180;
    const X = (az) => W / 2 + rel(az) * ppd;
    const Y = (alt) => horizonY - alt * ppd * this.VEX;
    const fs = W < 640 ? 13 : 17;

    // sky: black, no atmosphere and no glow
    ctx.fillStyle = "#02040a";
    ctx.fillRect(0, 0, W, H);
    for (const st of this.stars) {
      const x = X(st.az);
      if (x < 0 || x > W) continue;
      ctx.globalAlpha = st.a * (p.sunVis ? 0.55 : 1);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(x, st.f * horizonY * 1.1, st.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // bodies first, so terrain naturally covers them
    const bodies = [
      { name: "Earth", az: p.earthAz, alt: p.earthAlt, vis: p.earthVis, r: 15, fill: "#2f7fd0", rim: "#9fd4ff" },
      { name: "Sun", az: p.sunAz, alt: p.sunAlt, vis: p.sunVis, r: 13, fill: "#fff3c4", rim: "#ffb000" },
    ];
    for (const b of bodies) {
      b.x = X(b.az); b.y = Y(b.alt);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.2832);
      ctx.fillStyle = b.fill; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = b.rim; ctx.stroke();
    }

    // terrain silhouette from the horizon profile (flat line when there is none)
    const hz = ts.horizon;
    const hAt = (az) => {
      if (!hz) return 0;
      const L = hz.horizon_deg.length;
      const q = ((((az % 360) + 360) % 360) / 360) * L;
      const i = Math.floor(q) % L, j = (i + 1) % L, f = q - Math.floor(q);
      return hz.horizon_deg[i] + (hz.horizon_deg[j] - hz.horizon_deg[i]) * f;
    };
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let px = 0; px <= W; px += 2) ctx.lineTo(px, Y(hAt(this.yaw + (px - W / 2) / ppd)));
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, horizonY - 60, 0, H);
    if (p.sunVis) { g.addColorStop(0, "#c2c5cc"); g.addColorStop(1, "#6a6e77"); }
    else { g.addColorStop(0, "#1d212b"); g.addColorStop(1, "#0b0e14"); }
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = p.sunVis ? "#f1f2f4" : "#4a5268"; ctx.stroke();

    // flat horizontal reference
    ctx.setLineDash([6, 6]); ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();
    ctx.setLineDash([]);

    // labels (and a dashed outline where a hidden body sits behind terrain)
    ctx.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    for (const b of bodies) {
      if (b.x < -40 || b.x > W + 40) continue;
      if (!b.vis) {
        ctx.setLineDash([5, 4]); ctx.lineWidth = 2.5; ctx.strokeStyle = b.rim;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2, 0, 6.2832); ctx.stroke();
        ctx.setLineDash([]);
      }
      const label = b.vis ? b.name : b.name + " (hidden)";
      const ly = b.y - b.r - 10;
      ctx.lineWidth = 4; ctx.strokeStyle = "#000"; ctx.strokeText(label, b.x, ly);
      ctx.fillStyle = "#fff"; ctx.fillText(label, b.x, ly);
    }

    // compass strip
    const stripH = fs + 22;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, H - stripH, W, stripH);
    const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const first = Math.ceil((this.yaw - this.FOV / 2) / 15) * 15;
    for (let a = first; a <= this.yaw + this.FOV / 2; a += 15) {
      const x = W / 2 + (a - this.yaw) * ppd;
      const az = ((a % 360) + 360) % 360;
      const major = az % 45 === 0;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, H - stripH); ctx.lineTo(x, H - stripH + (major ? 9 : 5)); ctx.stroke();
      if (major) {
        ctx.fillStyle = "#fff";
        ctx.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(names[az / 45], x, H - 8);
      } else if (expert && W >= 640) {
        ctx.fillStyle = "#aab3c5";
        ctx.font = `600 ${fs - 4}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(az + "°", x, H - 9);
      }
    }

    // on-canvas notes
    ctx.textAlign = "left";
    ctx.font = `italic 600 ${fs - 3}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.fillText(`Vertical scale ×${this.VEX}` + (hz ? "" : "  ·  Terrain: none (flat horizon)"), 12, fs + 6);
    if (expert) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText("0° flat horizontal", 12, Y(0) - 6);
    }
  },
};

/* ---------- 3D site map (three.js) ---------- */

const MapView = {
  el: null,
  ready: false,
  failed: false,
  cache: {},      // site id -> {meta, heights} or null when there is no terrain file
  siteId: null,
  loadId: 0,
  theta: 0.6, phi: 1.0, radius: 20, size: 16,

  init(el) { this.el = el; },

  ensure() {
    if (this.ready) return true;
    if (this.failed) return false;
    try {
      if (typeof THREE === "undefined") throw new Error("three.js is not loaded");
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      this.failed = true;
      document.getElementById("map-status").innerHTML = "<strong>3D view is not available in this browser.</strong>";
      return false;
    }
    const T = THREE;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.el.appendChild(this.renderer.domElement);
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x02040a);
    this.camera = new T.PerspectiveCamera(40, 1, 0.05, 1000);
    this.sun = new T.DirectionalLight(0xffffff, 3.2);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new T.AmbientLight(0xffffff, 0.22)); // small fill so unlit slopes stay readable
    this.group = new T.Group();
    this.scene.add(this.group);
    this.ray = new T.Raycaster();

    // orbit controls: drag to rotate, wheel to zoom, click on the marker to open the surface view
    const dom = this.renderer.domElement;
    let last = null, moved = 0;
    dom.addEventListener("pointerdown", (e) => { last = [e.clientX, e.clientY]; moved = 0; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener("pointermove", (e) => {
      if (!last) return;
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      moved += Math.abs(dx) + Math.abs(dy);
      last = [e.clientX, e.clientY];
      this.theta -= dx * 0.008;
      this.phi = Math.max(0.12, Math.min(1.5, this.phi - dy * 0.006));
      this.render();
    });
    dom.addEventListener("pointerup", (e) => {
      const click = last && moved < 6;
      last = null;
      if (!click || !this.pick) return;
      const r = dom.getBoundingClientRect();
      const ndc = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(ndc, this.camera);
      if (this.ray.intersectObject(this.pick).length) setView("surface");
    });
    dom.addEventListener("pointercancel", () => { last = null; });
    dom.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.radius = Math.max(this.size * 0.15, Math.min(this.size * 3, this.radius * Math.exp(e.deltaY * 0.001)));
      this.render();
    }, { passive: false });
    this.ready = true;
    return true;
  },

  async load(id) {
    if (id in this.cache) return this.cache[id];
    let dem = null;
    try {
      const m = await fetch(`dem/${encodeURIComponent(id)}.json`);
      const b = await fetch(`dem/${encodeURIComponent(id)}.bin`);
      if (m.ok && b.ok) {
        const meta = await m.json();
        const heights = new Uint16Array(await b.arrayBuffer());
        if (heights.length === meta.n * meta.n) dem = { meta, heights };
      }
    } catch (e) { /* no terrain file: flat surface */ }
    this.cache[id] = dem;
    return dem;
  },

  rod(color, length, radius) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), new THREE.MeshBasicMaterial({ color }));
    mesh.userData.length = length;
    return mesh;
  },

  aim(rod, dir, origin) {
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    rod.position.copy(origin).addScaledVector(dir, rod.userData.length / 2);
  },

  build(dem) {
    const T = THREE;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    let geo;
    const note = document.getElementById("map-note");
    if (dem) {
      const { meta, heights } = dem;
      const n = meta.n, size = meta.size_m / 1000, span = (meta.z_max - meta.z_min) / 1000;
      this.size = size;
      const centre = (heights[(n >> 1) * n + (n >> 1)] / 65535) * span;
      const pos = new Float32Array(n * n * 3);
      for (let r = 0, k = 0; r < n; r++) {
        for (let c = 0; c < n; c++, k += 3) {
          pos[k] = (c / (n - 1) - 0.5) * size;
          pos[k + 1] = (heights[r * n + c] / 65535) * span - centre;
          pos[k + 2] = (r / (n - 1) - 0.5) * size;   // row 0 = top of the map tile
        }
      }
      const idx = new Uint32Array((n - 1) * (n - 1) * 6);
      for (let r = 0, k = 0; r < n - 1; r++) {
        for (let c = 0; c < n - 1; c++, k += 6) {
          const a = r * n + c, b = a + n, c2 = a + 1, d = b + 1;
          idx[k] = a; idx[k + 1] = b; idx[k + 2] = c2;
          idx[k + 3] = b; idx[k + 4] = d; idx[k + 5] = c2;
        }
      }
      geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      geo.setIndex(new T.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      this.north = new T.Vector3(meta.north[0], 0, -meta.north[1]).normalize();
      this.east = new T.Vector3(meta.east[0], 0, -meta.east[1]).normalize();
      note.textContent = `Terrain: LOLA 5 m DEM averaged to ${n} × ${n} points, tile ${size} km wide, heights ${meta.z_min} to ${meta.z_max} m, ` +
        "true vertical scale. Brightness shows slopes that face the Sun; cast shadows are not computed.";
    } else {
      this.size = 16;
      geo = new T.PlaneGeometry(this.size, this.size);
      geo.rotateX(-Math.PI / 2);
      this.north = new T.Vector3(0, 0, -1);
      this.east = new T.Vector3(1, 0, 0);
      note.textContent = "Terrain: none for this site. A flat surface is shown, so the shading carries no terrain information.";
    }
    this.hasDem = !!dem;
    this.group.add(new T.Mesh(geo, new T.MeshLambertMaterial({ color: 0xb4b4b4 })));

    const s = this.size;
    this.origin = new T.Vector3(0, s * 0.012, 0);
    const marker = new T.Mesh(new T.SphereGeometry(s * 0.014, 20, 14), new T.MeshBasicMaterial({ color: 0xffffff }));
    marker.position.copy(this.origin);
    this.pick = new T.Mesh(new T.SphereGeometry(s * 0.06, 12, 8), new T.MeshBasicMaterial({ visible: false }));
    this.pick.position.copy(this.origin);
    this.sunRod = this.rod(0xffb000, s * 0.24, s * 0.005);
    this.earthRod = this.rod(0x56b4e9, s * 0.24, s * 0.005);
    const northRod = this.rod(0xffffff, s * 0.14, s * 0.0025);
    this.aim(northRod, this.north, this.origin);
    this.group.add(marker, this.pick, this.sunRod, this.earthRod, northRod);
    this.radius = s * 1.15;
  },

  /* Direction in the scene for a calculated azimuth / altitude at the site. */
  dir(azDeg, altDeg) {
    const az = (azDeg * Math.PI) / 180, alt = (altDeg * Math.PI) / 180;
    return new THREE.Vector3()
      .addScaledVector(this.north, Math.cos(az) * Math.cos(alt))
      .addScaledVector(this.east, Math.sin(az) * Math.cos(alt))
      .add(new THREE.Vector3(0, Math.sin(alt), 0))
      .normalize();
  },

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  },

  async show() {
    if (!state.res || !this.ensure()) return;
    this.resize();
    const an = (state.res[state.viewKey] || state.res.a).an;
    if (this.siteId !== an.site_id || !this.group.children.length) {
      const token = ++this.loadId;
      document.getElementById("map-status").innerHTML = "Loading terrain…";
      const dem = await this.load(an.site_id);
      if (token !== this.loadId) return;
      this.siteId = an.site_id;
      this.build(dem);
    }
    this.update();
  },

  update() {
    const ts = viewTs();
    if (!this.ready || !ts || !this.sunRod) return;
    const p = sampleAt(ts, state.pos);
    const sunDir = this.dir(p.sunAz, p.sunAlt);
    this.sun.position.copy(sunDir).multiplyScalar(100);
    this.sun.target.position.set(0, 0, 0);
    this.aim(this.sunRod, sunDir, this.origin);
    this.aim(this.earthRod, this.dir(p.earthAz, p.earthAlt), this.origin);
    const an = (state.res[state.viewKey] || state.res.a).an;
    const site = siteById(an.site_id);
    const word = (v) => (v ? "visible" : "hidden");
    document.getElementById("map-status").innerHTML =
      `<strong>${esc(site ? site.name : an.site_id)}</strong>` + (this.hasDem ? "" : " · terrain: none (flat surface)") +
      `<br>From the site: Sun ${word(p.sunVis)} · Earth ${word(p.earthVis)}`;
    this.render();
  },

  render() {
    if (!this.ready) return;
    const sp = Math.sin(this.phi);
    this.camera.position.set(this.radius * sp * Math.sin(this.theta), this.radius * Math.cos(this.phi), this.radius * sp * Math.cos(this.theta));
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  },
};
