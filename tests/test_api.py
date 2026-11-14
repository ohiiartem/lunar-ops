"""Checks for the FastAPI endpoints (demo mode = SYNTHETIC ephemeris, only the plumbing is tested).

Run: .venv/bin/python tests/test_api.py   (also works with pytest)
"""
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.api import service  # noqa: E402
from backend.calc import ephemeris  # noqa: E402
from backend.main import app  # noqa: E402

client = TestClient(app)
BODY = {"site_id": "Site01", "start": "2026-12-01T00:00:00Z", "days": 30, "step_min": 30}


def demo(on):
    if on:
        os.environ["LUNAR_OPS_DEMO"] = "1"
    else:
        os.environ.pop("LUNAR_OPS_DEMO", None)


def err(r, status, code):
    assert r.status_code == status, (r.status_code, r.text)
    assert r.json()["error"]["code"] == code, r.text


def test_no_data_means_503():
    demo(False)
    err(client.post("/api/analyze", json=BODY), 503, "data_unavailable")
    site = client.get("/api/sites").json()["sites"][0]
    assert site["data_source"] == "none" and site["has_terrain"] is True


def test_sites_and_analyze_in_demo_mode():
    demo(True)
    site = client.get("/api/sites").json()["sites"][0]
    assert site["id"] == "Site01" and site["data_source"] == "synthetic_demo"
    r = client.post("/api/analyze", json=BODY)
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["data_source"] == "synthetic_demo" and m["terrain_used"] is True
    assert m["period_hours"] == 720.0 and 0 <= m["light_hours"] <= 720
    assert {"light_windows", "sun_status", "time_to_sunset_h", "longest_darkness_hours"} <= set(m)


def test_terrain_flag_changes_result():
    demo(True)
    a = client.post("/api/analyze", json={**BODY, "use_terrain": True}).json()
    b = client.post("/api/analyze", json={**BODY, "use_terrain": False}).json()
    assert b["terrain_used"] is False and a["light_hours"] != b["light_hours"]


def test_timeseries_shape():
    demo(True)
    r = client.post("/api/timeseries", json=BODY).json()
    n = len(r["t"])
    assert n == 1440
    for k in ("sun_alt", "sun_az", "sun_horizon", "sun_visible", "earth_alt", "earth_az",
              "earth_horizon", "earth_visible", "both_visible"):
        assert len(r[k]) == n, k
    assert len(r["horizon"]["azimuth_deg"]) == 360 == len(r["horizon"]["horizon_deg"])
    flat = client.post("/api/timeseries", json={**BODY, "use_terrain": False}).json()
    assert "horizon" not in flat


def test_compare_and_mission_shift():
    demo(True)
    shifted = {**BODY, "start": "2026-12-06T00:00:00Z"}
    r = client.post("/api/compare", json={"a": BODY, "b": shifted})
    assert r.status_code == 200, r.text
    c = r.json()
    for k, v in c["delta"].items():
        assert abs(v - (c["b"][k] - c["a"][k])) < 0.06, k
    assert c["summary"].startswith("Scenario B has")


def test_errors():
    demo(True)
    err(client.post("/api/analyze", json={**BODY, "site_id": "R99"}), 404, "site_not_found")
    err(client.post("/api/analyze", json={**BODY, "days": 0}), 422, "bad_params")
    err(client.post("/api/analyze", json={"site_id": "Site01"}), 422, "bad_params")
    err(client.post("/api/analyze", json={**BODY, "days": 100, "step_min": 5}), 422, "too_many_points")
    err(client.post("/api/analyze", json={**BODY, "start": "2020-01-01T00:00:00Z"}), 422, "date_out_of_range")
    err(client.post("/api/compare", json={"a": BODY, "b": {**BODY, "days": 10}}), 422, "incompatible_scenarios")


def test_real_table_is_preferred_over_demo():
    """A horizons_<site>.csv file overrides demo mode and its range limits the dates."""
    demo(True)
    old_dir = ephemeris.DATA_DIR
    tmp = Path(tempfile.mkdtemp())
    try:
        for name in ("sites.json", "horizon_Site01.json"):
            shutil.copy(old_dir / name, tmp / name)
        # 10 days, 30-minute step; Sun always 2 deg up, Earth always 5 deg up
        rows = ["t,sun_az,sun_alt,earth_az,earth_alt"] + [
            f"{(datetime(2026, 12, 1) + timedelta(minutes=30 * i)):%Y-%m-%dT%H:%M:%SZ},100,2.0,50,5.0"
            for i in range(48 * 10)
        ]
        (tmp / "horizons_Site01.csv").write_text("\n".join(rows))
        ephemeris.DATA_DIR = tmp
        service._sites.cache_clear()
        service._profile.cache_clear()
        r = client.post("/api/analyze", json={**BODY, "days": 5, "use_terrain": False})
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["data_source"] == "jpl_horizons"
        assert m["light_hours"] == 120.0 and m["both_hours"] == 120.0  # 5 days, always visible
        err(client.post("/api/analyze", json={**BODY, "days": 30}), 422, "date_out_of_range")
        err(client.post("/api/analyze", json={**BODY, "days": 5, "step_min": 45}), 422, "bad_params")
    finally:
        ephemeris.DATA_DIR = old_dir
        service._sites.cache_clear()
        service._profile.cache_clear()
        shutil.rmtree(tmp)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
