"""Glue between the HTTP layer and the calculation core (plain function calls, no JSON here)."""
import json
from datetime import timedelta
from functools import lru_cache

from backend.api.errors import ApiError
from backend.calc import ephemeris
from backend.calc.combine import combine
from backend.calc.metrics import analyze as compute_metrics

MAX_POINTS = 5000


@lru_cache(maxsize=1)
def _sites():
    """Sites shown to the API. An entry with "enabled": false stays in sites.json but is hidden (no data yet)."""
    return [s for s in json.loads((ephemeris.DATA_DIR / "sites.json").read_text()) if s.get("enabled", True)]


def get_site(site_id):
    for s in _sites():
        if s["id"] == site_id:
            return s
    raise ApiError(404, "site_not_found", f"Unknown site_id '{site_id}'")


@lru_cache(maxsize=8)
def _profile(filename):
    path = ephemeris.DATA_DIR / filename
    return json.loads(path.read_text()) if path.exists() else None


def list_sites():
    out = []
    for s in _sites():
        try:
            rng = ephemeris.data_range(s["id"])
            source = ephemeris.data_source(s["id"])
        except ephemeris.BadTable:  # unusable table: shown as "no data", the reason is in /api/health
            rng, source = None, "none"
        out.append({
            "id": s["id"], "name": s["name"], "lat": s["lat"], "lon": s["lon"], "source": s["source"],
            "has_terrain": _profile(s["horizon_file"]) is not None,
            "data_source": source,
            "data_from": rng[0].strftime("%Y-%m-%dT%H:%M:%SZ") if rng else None,
            "data_to": rng[1].strftime("%Y-%m-%dT%H:%M:%SZ") if rng else None,
        })
    return {"sites": out}


def run_scenario(sc):
    """Validate a scenario, then Ephemeris -> Combine. Returns (series, profile_or_None, data_source)."""
    site = get_site(sc.site_id)
    if sc.days * 1440 / sc.step_min > MAX_POINTS:
        raise ApiError(422, "too_many_points", f"More than {MAX_POINTS} points; use a larger step_min or fewer days")
    try:
        rng = ephemeris.data_range(sc.site_id)
    except ephemeris.BadTable as e:
        raise ApiError(503, "data_invalid", f"Ephemeris table for {sc.site_id} is unusable: {e}")
    if rng is None:
        raise ApiError(503, "data_unavailable", f"No ephemeris data for {sc.site_id}")
    if sc.start < rng[0] or sc.start + timedelta(days=sc.days) > rng[1]:
        raise ApiError(422, "date_out_of_range", f"Data for {sc.site_id} covers {rng[0]:%Y-%m-%d} to {rng[1]:%Y-%m-%d}")
    try:
        eph, source = ephemeris.get_ephemeris(sc.site_id, sc.start, sc.days, sc.step_min)
    except ephemeris.BadGrid as e:
        raise ApiError(422, "bad_params", str(e))
    except ephemeris.DataUnavailable as e:
        raise ApiError(503, "data_unavailable", str(e))
    profile = _profile(site["horizon_file"]) if sc.use_terrain else None
    series = combine(profile=profile, **eph)
    return series, profile, source


def _echo(sc):
    return {"site_id": sc.site_id, "start": sc.start.strftime("%Y-%m-%dT%H:%M:%SZ"), "days": sc.days, "step_min": sc.step_min}


def analyze(sc):
    series, _, source = run_scenario(sc)
    return {**_echo(sc), "data_source": source, **compute_metrics(series)}


def timeseries(sc):
    series, profile, source = run_scenario(sc)
    out = {"site_id": sc.site_id, "data_source": source, **series}
    if profile is not None:
        out["horizon"] = {
            "azimuth_deg": profile["azimuth_deg"],
            "horizon_deg": [round(x, 2) for x in profile["horizon_deg"]],
        }
    return out


VERSION = "0.1.0"


def health():
    """Server state for debugging: mode, and per site whether a valid table and a horizon profile exist."""
    sites = []
    for s in _sites():
        info = ephemeris.table_info(s["id"])
        sites.append({
            "id": s["id"],
            "terrain_profile": _profile(s["horizon_file"]) is not None,
            "table": info,
            "data_source": "jpl_horizons" if info["valid"] else ("synthetic_demo" if ephemeris.demo_enabled() else "none"),
        })
    real = sum(1 for x in sites if x["table"]["valid"])
    mode = "real" if real == len(sites) else "mixed" if real else "demo" if ephemeris.demo_enabled() else "no_data"
    problems = [f"{x['id']}: {x['table']['error']}" for x in sites if x["table"]["present"] and not x["table"]["valid"]]
    problems += [f"{x['id']}: no horizon profile" for x in sites if not x["terrain_profile"]]
    return {"status": "ok" if not problems else "degraded", "version": VERSION, "mode": mode,
            "demo_enabled": ephemeris.demo_enabled(), "problems": problems, "sites": sites}
