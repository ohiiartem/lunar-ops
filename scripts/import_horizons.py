"""Build backend/data/horizons_<site>.csv from the Sun and Earth tables exported from JPL Horizons.

Input: one or several CSV files per body (several = consecutive chunks of one period). Needed columns are found by
header name: Time, Azimuth_deg, Elevation_deg (the others are ignored). Time looks like "2026-Nov-14 00:00".
Output columns: t,sun_az,sun_alt,earth_az,earth_alt (ISO 8601 UTC with Z), validated before writing.

Usage:
  .venv/bin/python scripts/import_horizons.py Site01 --sun sun_R01.csv --earth earth_R01.csv
  .venv/bin/python scripts/import_horizons.py Site01 --sun a.csv b.csv --earth c.csv d.csv [--out path] [--dry-run]
"""
import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.calc.ephemeris import BadTable, COLUMNS, validate_table  # noqa: E402

TIME_FORMATS = ("%Y-%b-%d %H:%M:%S", "%Y-%b-%d %H:%M", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M")


def parse_time(text, where):
    text = text.strip()
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    sys.exit(f"{where}: cannot parse time '{text}'")


def read_body(paths, label):
    """Returns {datetime: (azimuth, elevation)} merged over the files. Identical duplicates are allowed."""
    out = {}
    for path in paths:
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            first = next(reader, None)
            if first is None:
                sys.exit(f"{path}: file is empty")
            header = [h.strip() for h in first]
            for need in ("Time", "Azimuth_deg", "Elevation_deg"):
                if need not in header:
                    sys.exit(f"{path}: no column '{need}' (found: {', '.join(header)})")
            i_t, i_az, i_el = header.index("Time"), header.index("Azimuth_deg"), header.index("Elevation_deg")
            for n, row in enumerate(reader, start=2):
                if not row or not "".join(row).strip():
                    continue
                where = f"{path} line {n}"
                try:
                    val = (float(row[i_az]), float(row[i_el]))
                except (ValueError, IndexError):
                    sys.exit(f"{where}: azimuth/elevation is not a number: {row}")
                t = parse_time(row[i_t], where)
                if t in out and out[t] != val:
                    sys.exit(f"{where}: time {t} appears twice with different values")
                out[t] = val
    if not out:
        sys.exit(f"{label}: no rows read")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("site_id")
    ap.add_argument("--sun", nargs="+", required=True)
    ap.add_argument("--earth", nargs="+", required=True)
    ap.add_argument("--out", help="default: backend/data/horizons_<site_id>.csv")
    ap.add_argument("--dry-run", action="store_true", help="check and print, do not write")
    a = ap.parse_args()

    sun, earth = read_body(a.sun, "sun"), read_body(a.earth, "earth")
    if sun.keys() != earth.keys():
        only_s, only_e = sorted(sun.keys() - earth.keys()), sorted(earth.keys() - sun.keys())
        sys.exit(f"Sun and Earth time grids differ: {len(only_s)} times only in Sun (first {only_s[:1]}), "
                 f"{len(only_e)} only in Earth (first {only_e[:1]})")
    times = sorted(sun)
    t = np.array([x.strftime("%Y-%m-%dT%H:%M:%S") for x in times], dtype="datetime64[s]")
    cols = dict(zip(COLUMNS, (np.array([sun[x][0] for x in times]), np.array([sun[x][1] for x in times]),
                              np.array([earth[x][0] for x in times]), np.array([earth[x][1] for x in times]))))
    try:
        validate_table(t, cols)
    except BadTable as e:
        sys.exit(f"Table is not usable: {e}")

    step = int((t[1] - t[0]) / np.timedelta64(60, "s"))
    print(f"{a.site_id}: {len(t)} rows, step {step} min, {times[0]:%Y-%m-%d %H:%M} to {times[-1]:%Y-%m-%d %H:%M} UTC")
    print(f"  Sun  alt {cols['sun_alt'].min():.2f}..{cols['sun_alt'].max():.2f} deg, az {cols['sun_az'].min():.1f}..{cols['sun_az'].max():.1f}")
    print(f"  Earth alt {cols['earth_alt'].min():.2f}..{cols['earth_alt'].max():.2f} deg, az {cols['earth_az'].min():.1f}..{cols['earth_az'].max():.1f}")
    if a.dry_run:
        print("  dry run: nothing written")
        return
    out = Path(a.out) if a.out else ROOT / f"backend/data/horizons_{a.site_id}.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(("t",) + COLUMNS)
        for i, x in enumerate(times):
            w.writerow((x.strftime("%Y-%m-%dT%H:%M:%SZ"), sun[x][0], sun[x][1], earth[x][0], earth[x][1]))
    print(f"  wrote {out}")


if __name__ == "__main__":
    main()
