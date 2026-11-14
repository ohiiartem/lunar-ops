"""Build one site: horizon profile from its LOLA tile + entry in sites.json + a plot.

The site position is the CENTER of the LOLA tile (for Site01 and Site11 this equals R01 / R11 of the
Lunar Surface Data Book). Rays are limited to the tile (half width minus 100 m).

Usage: .venv/bin/python scripts/build_site.py Site23 [path_to_tif]
Writes: backend/data/horizon_<id>.json, docs/<id>_horizon.png, updates backend/data/sites.json
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LightSource
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.calc.horizon import MOON_GEOGRAPHIC, horizon_profile, load_dem, local_axes  # noqa: E402

DATA_BOOK = "Lunar Surface Data Book M2M-30044, table A2.1-1; LOLA 5 m DEM (PGDA)"
TILE_ONLY = "LOLA 5 m DEM (PGDA); position = tile center"
SITE_INFO = {  # id: (name, source)
    "Site01": ("R01 · Connecting ridge", DATA_BOOK),
    "Site11": ("R11 · de Gerlache rim", DATA_BOOK),
    "Site23": ("R23 · Malapert massif", TILE_ONLY),
    "Site06": ("R06 · Nobile rim 1", TILE_ONLY),
}
OBSERVER_HEIGHT_M = 2.0  # assumption: lander / antenna height (see README)

site_id = sys.argv[1]
tif = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / f"backend/data/{site_id}_final_adj_5mpp_surf.tif"
name, source = SITE_INFO.get(site_id, (site_id, TILE_ONLY))

dem = load_dem(tif)
n_rows, n_cols = dem.z.shape
cx, cy = dem.left + n_cols * dem.res / 2, dem.top - n_rows * dem.res / 2
lon, lat = Transformer.from_crs(dem.crs, MOON_GEOGRAPHIC, always_xy=True).transform(cx, cy)
lat, lon = round(lat, 5), round(lon, 5)
max_dist = min(n_cols, n_rows) * dem.res / 2 - 100.0

profile = horizon_profile(dem, lat, lon, observer_height_m=OBSERVER_HEIGHT_M, max_dist_m=max_dist)
profile = {"site_id": site_id, "observer_height_m": OBSERVER_HEIGHT_M, **profile}
(ROOT / f"backend/data/horizon_{site_id}.json").write_text(json.dumps(profile))

sites_path = ROOT / "backend/data/sites.json"
sites = json.loads(sites_path.read_text())
entry = {"id": site_id, "name": name, "lat": lat, "lon": lon, "source": source, "horizon_file": f"horizon_{site_id}.json"}
sites = [entry if s["id"] == site_id else s for s in sites]
if not any(s["id"] == site_id for s in sites):
    sites.append(entry)
sites_path.write_text(json.dumps(sites, indent=2, ensure_ascii=False) + "\n")

az = np.array(profile["azimuth_deg"])
hz = np.array(profile["horizon_deg"])
dist = np.array(profile["blocking_distance_m"])
k = int(np.nanargmax(hz))
print(f"{site_id}: lat {lat}, lon {lon}, tile {n_cols}x{n_rows} px, observer elevation {profile['observer_elevation_m']:.0f} m, rays {max_dist:.0f} m")
print(f"  horizon: min {np.nanmin(hz):.2f}, max {np.nanmax(hz):.2f}, mean {np.nanmean(hz):.2f} deg; "
      f"highest at az {az[k]:.0f} deg ({dist[k]:.0f} m away); median blocker {np.median(dist):.0f} m")

fig, ax = plt.subplots(1, 2, figsize=(14, 5.5), gridspec_kw={"width_ratios": [1.3, 1]})
ax[0].fill_between(az, hz, np.nanmin(hz) - 0.5, color="0.25")
ax[0].plot(az, hz, color="k", lw=1)
ax[0].axhline(0, color="tab:blue", lw=1, ls="--", label="flat horizon (0 deg)")
ax[0].set_xlim(0, 360)
ax[0].set_ylim(np.nanmin(hz) - 0.5, np.nanmax(hz) + 0.5)
ax[0].set_xticks([0, 45, 90, 135, 180, 225, 270, 315, 360])
ax[0].set_xticklabels(["N 0", "NE 45", "E 90", "SE 135", "S 180", "SW 225", "W 270", "NW 315", "N 360"])
ax[0].set_xlabel("Azimuth, deg (from north, clockwise)")
ax[0].set_ylabel("Terrain elevation angle, deg")
ax[0].set_title(f"Horizon silhouette seen from {site_id} (lat {lat}, lon {lon})")
ax[0].legend(loc="upper right")

shade = LightSource(azdeg=315, altdeg=20).hillshade(dem.z, vert_exag=1.0, dx=dem.res, dy=dem.res)
extent_km = [dem.left / 1000, (dem.left + n_cols * dem.res) / 1000, (dem.top - n_rows * dem.res) / 1000, dem.top / 1000]
ax[1].imshow(shade, cmap="gray", extent=extent_km)
(x0, y0), north, east = local_axes(dem.crs, lat, lon)
x0, y0 = x0 / 1000, y0 / 1000
ax[1].plot(x0, y0, "r*", ms=14, label="observer")
for vec, label in ((north, "N"), (east, "E")):
    ax[1].annotate("", xy=(x0 + 1.2 * vec[0], y0 + 1.2 * vec[1]), xytext=(x0, y0),
                   arrowprops=dict(arrowstyle="->", color="tab:orange", lw=2))
    ax[1].text(x0 + 1.7 * vec[0], y0 + 1.7 * vec[1], label, color="tab:orange", fontsize=13,
               fontweight="bold", ha="center", va="center")
a = np.radians(az[k])
dvec = np.cos(a) * north + np.sin(a) * east
ax[1].plot([x0, x0 + dist[k] / 1000 * dvec[0]], [y0, y0 + dist[k] / 1000 * dvec[1]], "c--", lw=2,
           label=f"highest horizon: az {az[k]:.0f} deg, {hz[k]:.1f} deg")
ax[1].set_title("Map: N/E arrows and direction of the highest horizon")
ax[1].set_xlabel("X, km")
ax[1].set_ylabel("Y, km")
ax[1].legend(loc="upper left", fontsize=8)
plt.tight_layout()
plt.savefig(ROOT / f"docs/{site_id}_horizon.png", dpi=110)
print(f"  saved docs/{site_id}_horizon.png")
