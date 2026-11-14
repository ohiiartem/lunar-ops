# Lunar OPS: API and data contracts

Status: draft v1 (matches `backend/calc/combine.py` and `backend/calc/metrics.py`).
All numbers in the examples are **illustrative**, not real results.

## 1. Common rules

- Browser <-> server: JSON only. Server internals are plain Python function calls.
- Time: ISO 8601, UTC, with a trailing `Z` (`2026-12-01T00:00:00Z`).
- Angles in degrees. **Azimuth: 0 = north, 90 = east, clockwise** (same as JPL Horizons).
  Altitude: angle above the local horizontal (negative = below).
- Durations in hours (`*_hours`, `*_h`).
- Defaults: `step_min = 30`, `use_terrain = true`.
- Wording: "potential sunlight", "geometric Earth visibility" (not link quality). Prototype, not a mission tool.

### Error format (all endpoints)

```json
{"error": {"code": "site_not_found", "message": "Unknown site_id 'R99'"}}
```

| HTTP | code | When |
|---|---|---|
| 404 | `site_not_found` | `site_id` is not in `/api/sites` |
| 422 | `bad_params` | missing field, wrong type, `days < 1`, `step_min` not in 5..120 |
| 422 | `date_out_of_range` | the period is outside the precomputed data range of the site |
| 422 | `too_many_points` | `days * 1440 / step_min > 5000` |
| 422 | `incompatible_scenarios` | `/api/compare`: `a.days != b.days` or `a.step_min != b.step_min` |
| 503 | `data_unavailable` | an ephemeris table or horizon profile file is missing on the server |

## 2. `GET /api/sites`

Response `200`:

```json
{
  "sites": [
    {
      "id": "Site01",
      "name": "R01 (LOLA Site01, connecting ridge)",
      "lat": -89.4632,
      "lon": -137.49,
      "source": "Lunar Surface Data Book M2M-30044, table A2.1-1; LOLA 5 m DEM (PGDA)",
      "has_terrain": true,
      "data_from": "2026-12-01T00:00:00Z",
      "data_to": "2027-01-31T00:00:00Z"
    }
  ]
}
```

`has_terrain` = a horizon profile exists for this site. `data_from`/`data_to` = range covered by the
stored Horizons table. Sites with `has_terrain = false` are analysed with a flat horizon only.

## 3. `POST /api/analyze`

Request:

```json
{"site_id": "Site01", "start": "2026-12-01T00:00:00Z", "days": 30, "step_min": 30, "use_terrain": true}
```

Response `200` (the `analyze()` result of `metrics.py` plus the echoed request):

```json
{
  "site_id": "Site01",
  "start": "2026-12-01T00:00:00Z",
  "days": 30,
  "step_min": 30,
  "terrain_used": true,
  "period_hours": 720.0,
  "light_hours": 539.5,
  "earth_visible_hours": 233.0,
  "both_hours": 103.5,
  "longest_darkness_hours": 150.0,
  "light_windows": [{"from": "2026-12-01T03:00:00Z", "to": "2026-12-07T04:00:00Z"}],
  "earth_windows": [{"from": "2026-12-02T00:00:00Z", "to": "2026-12-05T12:30:00Z"}],
  "both_windows": [{"from": "2026-12-02T00:00:00Z", "to": "2026-12-05T12:30:00Z"}],
  "sun_status": "down_until_rise",
  "time_to_sunset_h": null,
  "time_to_sunrise_h": 3.0,
  "earth_status": "up_until_set",
  "time_to_earth_set_h": 84.5,
  "time_to_earth_rise_h": null
}
```

Field notes:

- `*_status` is one of `up_until_set`, `up_all_period`, `down_until_rise`, `down_all_period`.
  It explains `null` values (for example `up_all_period` -> `time_to_*_set_h` is `null`: the body never sets).
- "Time to ..." is counted from `start`.
- Window edges are accurate to one `step_min`.

## 4. `POST /api/timeseries`

Request: same as `/api/analyze`.

Response `200` (the `combine()` result plus `site_id`). All arrays have the same length; element `i`
of every array belongs to `t[i]`:

```json
{
  "site_id": "Site01",
  "terrain_used": true,
  "t": ["2026-12-01T00:00:00Z", "2026-12-01T00:30:00Z"],
  "sun_alt": [1.52, 1.49],
  "sun_az": [210.4, 211.9],
  "sun_horizon": [0.8, 0.8],
  "sun_visible": [true, true],
  "earth_alt": [3.1, 3.0],
  "earth_az": [45.0, 45.4],
  "earth_horizon": [1.9, 1.9],
  "earth_visible": [true, true],
  "both_visible": [true, true]
}
```

- `sun_horizon` / `earth_horizon` = terrain angle at the body's azimuth (0 when `terrain_used` is false).
- Sun is visible when `sun_alt + 0.27 > sun_horizon` (upper limb). Earth is visible when `earth_alt > earth_horizon`.
- Typical size: 30 days at 30 min = 1440 points, about 115 KB. Server should enable gzip.

## 5. `POST /api/compare`

Request (`b` can be the same site with a shifted `start`: this is Mission Shift):

```json
{
  "a": {"site_id": "Site01", "start": "2026-12-01T00:00:00Z", "days": 30, "step_min": 30, "use_terrain": true},
  "b": {"site_id": "Site01", "start": "2026-12-06T00:00:00Z", "days": 30, "step_min": 30, "use_terrain": true}
}
```

Response `200`:

```json
{
  "a": { "...": "same object as the /api/analyze response" },
  "b": { "...": "same object as the /api/analyze response" },
  "delta": {
    "light_hours": -23.5,
    "earth_visible_hours": 10.0,
    "both_hours": -8.0,
    "longest_darkness_hours": 12.5
  },
  "summary": "Scenario B has 23.5 h less potential sunlight but Earth is geometrically visible for 10.0 h longer."
}
```

- `delta = b - a` (positive = B has more).
- `summary` is built by code from the numbers by fixed rules. Nothing is written by hand or invented.

## 6. Internal data formats (not HTTP)

### Horizon profile (LOLA -> Combine), file `backend/data/horizon_<site>.json`

```json
{
  "site_id": "Site01", "lat": -89.4632, "lon": -137.49,
  "observer_elevation_m": 1946.8, "observer_height_m": 2.0, "max_dist_m": 7900.0,
  "azimuth_deg": [0.0, 1.0, "... 360 values, step 1 deg"],
  "horizon_deg": [1.3, 1.4, "..."],
  "blocking_distance_m": [125.0, "..."]
}
```

### Ephemeris table (Loader -> Combine)

Output of the Horizons parser, one shared time grid for Sun and Earth, parallel arrays:

```json
{"t": ["2026-12-01T00:00:00Z"], "sun_az": [210.4], "sun_alt": [1.52], "earth_az": [45.0], "earth_alt": [3.1]}
```

Requirements for the Horizons request (to confirm with the person doing Loader):

- Observer on the Moon at the **same lat/lon as the site** (the horizon profile is only valid for that point).
- Azimuth from north, clockwise; altitude above the local horizontal; **no refraction**; UT; the same
  `step_min` for Sun and Earth; ephemeris version recorded (DE441 expected).
- Loader parses the text between `$$SOE` and `$$EOE` and strips the solar/lunar presence flags
  (`*`, `i`, ...) next to the time.
- Tables are stored on the server (`backend/data/`); the app never calls Horizons at request time.
