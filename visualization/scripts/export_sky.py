"""Save real API responses for the default scenario and its offline site list."""

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

START = "2026-11-14T00:00:00Z"
DAYS = 30
STEP_MIN = 30


def fetch(api, path, scenario=None):
    data = json.dumps(scenario).encode() if scenario else None
    request = Request(f"{api.rstrip('/')}/api/{path}", data=data, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, default=Path("public/data"))
    args = parser.parse_args()
    catalogue = fetch(args.api, "sites")
    saved_sites = []
    for site in catalogue["sites"]:
        if site["data_source"] != "jpl_horizons" or not site["data_from"] or not site["data_to"]:
            print(f"Skipped {site['id']}: no real ephemeris")
            continue
        start = max(START, site["data_from"])
        if datetime.fromisoformat(start) + timedelta(days=DAYS) > datetime.fromisoformat(site["data_to"]):
            print(f"Skipped {site['id']}: default period outside coverage")
            continue
        scenario = {"site_id": site["id"], "start": start, "days": DAYS,
                    "step_min": STEP_MIN, "use_terrain": site["has_terrain"]}
        series = fetch(args.api, "timeseries", scenario)
        analysis = fetch(args.api, "analyze", scenario)
        if any(data["data_source"] != "jpl_horizons" or data["site_id"] != site["id"]
               for data in (series, analysis)):
            raise ValueError(f"Unexpected response for {site['id']}")
        destination = args.output / site["id"].replace("Site", "R", 1) / "sky.json"
        write(destination, {"scenario": scenario, "timeseries": series, "analysis": analysis})
        # The bundled catalogue describes the scenarios actually saved here.
        saved_sites.append({**site, "data_from": start, "data_to":
                            (datetime.fromisoformat(start)+timedelta(days=DAYS)).isoformat().replace("+00:00","Z")})
        print(f"{destination}: {len(series['t'])} real observations")
    if not saved_sites:
        raise RuntimeError("No real snapshots exported")
    write(args.output / "sites.json", {"sites": saved_sites})


if __name__ == "__main__":
    main()
