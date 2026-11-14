# Lunar OPS

Prototype for NASA Space Apps 2026, challenge "Lunar Landing Site Navigator".
Compares "site + date" scenarios at the lunar south pole (potential sunlight, geometric Earth visibility).
Not a real mission planning tool.

## Run the 2D/3D visualization

With Node.js 22.12 or newer, run from the repository root:

```bash
cd visualization
npm ci
npm run dev
```

Open the local URL printed by Vite. The viewer includes the Sun–Earth–Moon system,
the lunar globe with landing markers, and the LOLA terrain and sky views for R01
and R11. Bundled JPL Horizons observations let the viewer run independently of
the Python server. See the [visualization README](visualization/README.md) for
controls, data coverage, and sources.

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

Site01 (about 41 MB, 16 x 16 km) is centered at lat -89.4632, lon -137.49, which matches site R01
of the Lunar Surface Data Book (M2M-30044, table A2.1-1).
About 90% of pixels in these polar DEMs are interpolated.

Citations: Barker et al. 2021, Planetary and Space Science 203, 105119,
doi:10.1016/j.pss.2020.105119; site numbering from Mazarico et al. 2011, Icarus 211, 1066-1081.

## Scripts

```bash
.venv/bin/python scripts/inspect_dem.py   # prints DEM metadata, writes docs/site01_relief.png
```
