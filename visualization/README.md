# Lunar OPS 2D/3D viewer

Run the FastAPI backend from the repository root, then start the visualization
with Node.js 22.12+ in a separate terminal.

```sh
# Repository root
.venv/bin/uvicorn backend.main:app --port 8000

# visualization/
npm ci
npm run dev
```

Open the Vite URL. Its development server and `npm run preview` proxy `/api`
to port 8000. For production, run `npm test && npm run build` in
`visualization/` and serve `visualization/dist/` from FastAPI on the same
origin as `/api`. The build uses relative asset paths (`base=./`).
Deploying or mounting the build is handled by the server owner.

## Scenarios and data

The site picker and globe markers follow `GET /api/sites`. The default
scenario starts on November 14, 2026 when the selected site covers that date.
It uses 30 days and 60-minute steps. The form shows UTC coverage and applies the
5,000-observation limit. Choosing a different site loads its default scenario.
Choose **Analyze** after changing the start date, duration, step or horizon model.

The views and visibility flags come from `POST /api/timeseries`. The summary
cards, rise/set times and windows come from `POST /api/analyze`. Mission Shift
compares the active scenario with its start shifted by 1, 5 or 10 days via
`POST /api/compare`. The difference and summary come from the same response.

**Simple** shows plain-language sunlight and Earth visibility. **Expert** adds
angles, coordinates, terrain controls and charts. Both modes share the selected
scenario, time and viewpoint. The lunar globe and local views follow the same
timeline.

The red **DEMO DATA** banner identifies synthetic observations. Bundled
`public/data/sites.json` and `public/data/R*/sky.json` are used when the API
is unreachable. They contain real responses from the default scenario, including
the analysis metrics. The amber **offline snapshot** banner identifies this
mode. Mission Shift requires the live API. Server validation errors are shown
without substituting the snapshots.

To refresh offline data with FastAPI running:

```sh
python3 scripts/export_sky.py --api http://127.0.0.1:8000
```

The exporter discovers sites through `/api/sites` and saves snapshots for real
datasets that cover the requested period. It skips synthetic and missing data.

## Visual layers

The globe uses NASA LROC color and elevation textures. The local 2D maps and
512 × 512 meshes are derived from LOLA. R23 and R06 use the team’s published
web DEM tiles for 3D. Where no mesh is bundled, the 3D viewer indicates the
level-surface fallback. The sky horizon follows the analyzed scenario.
Global Sun–Earth–Moon display paths are precomputed JPL vectors and are scaled
for readability. The scenario API supplies the landing-site observation angles.
These visual layers are separate from the visibility calculation.

- [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720)
- [NASA LOLA DEMs](https://pgda.gsfc.nasa.gov/products/78)
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
- [USGS lunar gazetteer](https://planetarynames.wr.usgs.gov/Page/MOON/target)
