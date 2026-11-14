"""Task 3.2 + 3.3: compute the horizon profile of a site, save it as JSON and plot it.

Usage: .venv/bin/python scripts/plot_horizon.py
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LightSource

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.calc.horizon import horizon_profile, load_dem, local_axes  # noqa: E402

SITE_ID = "Site01"  # = R01 of the Lunar Surface Data Book
LAT, LON = -89.4632, -137.49
TIF = ROOT / "backend/data/Site01_final_adj_5mpp_surf.tif"
OUT_JSON = ROOT / "backend/data/horizon_Site01.json"
OUT_PNG = ROOT / "docs/site01_horizon.png"

dem = load_dem(TIF)
# Assumption: observer 2 m above the surface (lander / antenna height). With 0 m the result is
# dominated by sub-10 m micro-relief right under the observer (see README, "Horizon profile").
OBSERVER_HEIGHT_M = 2.0
profile = horizon_profile(dem, LAT, LON, observer_height_m=OBSERVER_HEIGHT_M, max_dist_m=7900.0, az_step_deg=1.0)
profile["observer_height_m"] = OBSERVER_HEIGHT_M
profile = {"site_id": SITE_ID, **profile}
OUT_JSON.write_text(json.dumps(profile))

az = np.array(profile["azimuth_deg"])
hz = np.array(profile["horizon_deg"])
dist = np.array(profile["blocking_distance_m"])
k = int(np.nanargmax(hz))
print(f"observer elevation: {profile['observer_elevation_m']:.1f} m")
print(f"horizon angle: min={np.nanmin(hz):.2f} deg, max={np.nanmax(hz):.2f} deg, mean={np.nanmean(hz):.2f} deg")
print(f"highest horizon: {hz[k]:.2f} deg at azimuth {az[k]:.0f} deg, {dist[k]:.0f} m away")
print(f"saved: {OUT_JSON.relative_to(ROOT)}")

# --- plot: silhouette (left) and map with the viewing directions (right) ---
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
ax[0].set_title(f"Horizon silhouette seen from {SITE_ID} (lat {LAT}, lon {LON})")
ax[0].legend(loc="upper right")

z = dem.z
ls = LightSource(azdeg=315, altdeg=20)
shade = ls.hillshade(z, vert_exag=1.0, dx=dem.res, dy=dem.res)
n = z.shape[0]
extent_km = [dem.left / 1000, (dem.left + n * dem.res) / 1000, (dem.top - n * dem.res) / 1000, dem.top / 1000]
ax[1].imshow(shade, cmap="gray", extent=extent_km)
(x0, y0), north, east = local_axes(dem.crs, LAT, LON)
x0, y0 = x0 / 1000, y0 / 1000
ax[1].plot(x0, y0, "r*", ms=14, label="observer")
arrow = 1.2  # km
for vec, name in ((north, "N"), (east, "E")):
    ax[1].annotate("", xy=(x0 + arrow * vec[0], y0 + arrow * vec[1]), xytext=(x0, y0),
                   arrowprops=dict(arrowstyle="->", color="tab:orange", lw=2))
    ax[1].text(x0 + 1.4 * arrow * vec[0], y0 + 1.4 * arrow * vec[1], name, color="tab:orange",
               fontsize=13, fontweight="bold", ha="center", va="center")
a = np.radians(az[k])
dvec = np.cos(a) * north + np.sin(a) * east
reach = dist[k] / 1000
ax[1].plot([x0, x0 + reach * dvec[0]], [y0, y0 + reach * dvec[1]], "c--", lw=2,
           label=f"highest horizon: az {az[k]:.0f} deg, {hz[k]:.1f} deg")
ax[1].set_title("Map: N/E arrows and direction of the highest horizon")
ax[1].set_xlabel("X, km")
ax[1].set_ylabel("Y, km")
ax[1].legend(loc="upper left", fontsize=8)

plt.tight_layout()
plt.savefig(OUT_PNG, dpi=110)
print(f"saved: {OUT_PNG.relative_to(ROOT)}")
