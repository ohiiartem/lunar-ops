# Lunar OPS

Prototype for NASA Space Apps 2026, challenge "Lunar Landing Site Navigator".
Compares "site + date" scenarios at the lunar south pole (potential sunlight, geometric Earth visibility).
Not a real mission planning tool.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run the server

From the repository root:

```bash
LUNAR_OPS_DEMO=1 .venv/bin/uvicorn backend.main:app --reload
```

- Interactive API docs: http://127.0.0.1:8000/docs
- If a `frontend/` folder exists, it is served at `/`.
- **`LUNAR_OPS_DEMO=1` uses SYNTHETIC Sun/Earth positions** (made-up smooth curves), only so the page can be built
  before the JPL Horizons tables are ready. Responses then carry `"data_source": "synthetic_demo"` and the UI must
  show a warning. Real numbers come from `backend/data/horizons_<site_id>.csv` (columns
  `t,sun_az,sun_alt,earth_az,earth_alt`), which always takes precedence over demo mode.
- `GET /api/health` shows the mode and, per site, whether a valid table and horizon profile exist.
- Without demo mode and without a table the API answers `503 data_unavailable`.

## Tests

```bash
.venv/bin/python tests/test_horizon.py
.venv/bin/python tests/test_combine.py
.venv/bin/python tests/test_metrics.py
.venv/bin/python tests/test_api.py
```

## Data (not stored in git)

Terrain: LOLA 5 m/pixel DEM for south pole sites, from the
[PGDA LOLA_5mpp archive](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/).
Download into `backend/data/`:

```bash
curl -O --output-dir backend/data https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif
```

Sites used: Site01, Site11, Site23, Site06 (same URL pattern, `SiteXX/SiteXX_final_adj_5mpp_surf.tif`).
Each tile (16 x 16 km) is centered on the site; Site01 and Site11 match R01 and R11 of the
Lunar Surface Data Book (M2M-30044, table A2.1-1). Site23 and Site06 positions are tile centers (unconfirmed).
About 90% of pixels in these polar DEMs are interpolated.

Citations: Barker et al. 2021, Planetary and Space Science 203, 105119,
doi:10.1016/j.pss.2020.105119; site numbering from Mazarico et al. 2011, Icarus 211, 1066-1081.

## Scripts

```bash
.venv/bin/python scripts/inspect_dem.py            # prints DEM metadata, writes docs/site01_relief.png
.venv/bin/python scripts/build_site.py Site23      # horizon profile + sites.json entry + docs/Site23_horizon.png
.venv/bin/python scripts/build_dem_web.py          # small terrain grids for the 3D map -> frontend/dem/
.venv/bin/python scripts/import_horizons.py Site01 --sun sun.csv --earth earth.csv   # JPL tables -> backend/data/horizons_Site01.csv
```

## Layout

- `backend/calc/`: horizon, combine, metrics, ephemeris loader (plain Python)
- `backend/api/`, `backend/main.py`: FastAPI, serves `frontend/` at `/`
- `backend/data/`: `sites.json`, `horizon_<id>.json`, `horizons_<id>.csv` (JPL, pending), DEM `.tif` (not in git)
- `frontend/`: single page (vanilla JS + bundled three.js, no CDN), `frontend/dem/` terrain grids
- `docs/`: API contracts, horizon plots
