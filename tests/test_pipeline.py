import math, os, sys, tempfile, unittest
from datetime import datetime, timedelta
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from calc.loader import load_track
from calc.combine import visibility, terrain_angle, angular_radius_deg, SUN_RADIUS_KM
from calc.metrics import windows, hours, next_change, summary
from calc.horizon import HorizonProfile, load_profile
from calc.pipeline import run_site, export_site
from calc.sites import SITES

ROOT = os.path.join(os.path.dirname(__file__), "..")
HZ_DIR = os.path.join(ROOT, "data", "horizons")
PROFILE_DIR = os.path.join(ROOT, "data", "profiles")
HAVE_DATA = all(os.path.exists(os.path.join(HZ_DIR, f"{b}_{s}.csv")) for b in ("sun", "earth") for s in ("R01", "R11", "R23"))
HEADER = "Time,Sky_Flag,RA_h,DEC_deg,Azimuth_deg,Elevation_deg,Range_AU,RangeRate_AU_day,range_rate_au_day,range_km,x_east_km,y_north_km,z_up_km\n"


def write_csv(path, az, el, rng=150e6, start=datetime(2026, 11, 14), step_min=10, flags=None, shift=False, skip_row=False):
    lines = [HEADER]
    for i, (a, e) in enumerate(zip(az, el)):
        t = (start + timedelta(minutes=step_min * i)).strftime("%Y-%b-%d %H:%M")
        ar, er = math.radians(a), math.radians(e)
        vec = [rng * math.cos(er) * math.sin(ar), rng * math.cos(er) * math.cos(ar), rng * math.sin(er)]
        if shift:
            vec = vec[1:] + vec[:1]
        row = [t, (flags[i] if flags else ""), "0", "0", f"{a}", f"{e}", "1", "0", f"{rng}"] + [f"{v}" for v in vec]
        if skip_row and i == 1:
            row = row[:-1]
        lines.append(",".join(row) + "\n")
    with open(path, "w") as f:
        f.write("".join(lines))


def flat_profile(angle=0.0):
    return HorizonProfile(np.arange(360.0), np.full(360, float(angle)), np.full(360, 8000.0), 0.0, -89, 0, 20000, 0)


class Loader(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.p = os.path.join(self.d, "t.csv")

    def test_loads_synthetic(self):
        write_csv(self.p, [100, 101, 102], [1.0, 1.5, 2.0])
        t = load_track(self.p)
        self.assertEqual(len(t), 3)
        self.assertEqual(t.step_s, 600)
        self.assertAlmostEqual(float(t.el_deg[1]), 1.5)

    def test_wrong_column_count(self):
        write_csv(self.p, [100, 101, 102], [1, 1, 1], skip_row=True)
        with self.assertRaises(ValueError):
            load_track(self.p)

    def test_shifted_columns_detected(self):
        write_csv(self.p, [100, 101, 102], [1, 1, 1], shift=True)
        with self.assertRaises(ValueError):
            load_track(self.p)

    def test_non_uniform_step(self):
        write_csv(self.p, [100, 101, 102], [1, 1, 1])
        with open(self.p) as f:
            lines = f.read().splitlines(True)
        lines[3] = lines[3].replace("00:20", "00:25")
        with open(self.p, "w") as f:
            f.write("".join(lines))
        with self.assertRaises(ValueError):
            load_track(self.p)

    @unittest.skipUnless(HAVE_DATA, "Horizons files not found")
    def test_real_files(self):
        for b in ("sun", "earth"):
            for sid in ("R01", "R11", "R23"):
                t = load_track(os.path.join(HZ_DIR, f"{b}_{sid}.csv"))
                self.assertEqual(len(t), 145)
                self.assertEqual(t.step_s, 600)


class Combine(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def tracks(self, sun_el, earth_el, az=90.0):
        n = len(sun_el)
        ps, pe = os.path.join(self.d, "s.csv"), os.path.join(self.d, "e.csv")
        write_csv(ps, [az] * n, sun_el, rng=149.6e6)
        write_csv(pe, [az] * n, earth_el, rng=384.4e3)
        return load_track(ps), load_track(pe)

    def test_flat_sphere_sun_uses_upper_limb(self):
        sun, earth = self.tracks([-0.30, -0.20, 0.10], [1.0, 1.0, 1.0])
        v = visibility(sun, earth)
        self.assertEqual(list(v.sun_up), [False, True, True])   # sd ~ 0.2665 deg

    def test_earth_centre_vs_limb(self):
        sun, earth = self.tracks([1, 1, 1], [-0.5, 0.2, 1.5])
        self.assertEqual(list(visibility(sun, earth).earth_up), [False, True, True])
        self.assertEqual(list(visibility(sun, earth, earth_limb=True).earth_up), [True, True, True])

    def test_terrain_blocks(self):
        sun, earth = self.tracks([0.5, 1.5, 3.0], [0.5, 1.5, 3.0])
        v = visibility(sun, earth, flat_profile(1.0))
        self.assertEqual(list(v.sun_up), [False, True, True])     # 0.5+0.27 < 1.0, 1.5+0.27 > 1.0
        self.assertEqual(list(v.earth_up), [False, True, True])
        self.assertEqual(list(v.both), [False, True, True])
        self.assertTrue(v.terrain)

    def test_terrain_angle_interpolates_and_wraps(self):
        prof = flat_profile()
        prof.angle_deg = np.arange(360.0)           # angle == azimuth index
        out = terrain_angle(prof, np.array([0.0, 10.5, 359.5, 360.0, -0.5]))
        np.testing.assert_allclose(out, [0.0, 10.5, 179.5, 0.0, 179.5])
        np.testing.assert_allclose(terrain_angle(None, np.array([5.0, 200.0])), [0.0, 0.0])

    def test_time_mismatch_raises(self):
        sun, earth = self.tracks([1, 1, 1], [1, 1, 1])
        earth.times = earth.times + np.timedelta64(60, "s")
        with self.assertRaises(ValueError):
            visibility(sun, earth)

    def test_angular_radius(self):
        self.assertAlmostEqual(float(angular_radius_deg(SUN_RADIUS_KM, np.array([149.6e6]))[0]), 0.2664, places=3)


class Metrics(unittest.TestCase):
    def setUp(self):
        self.t = np.array([np.datetime64("2026-11-14T00:00:00") + np.timedelta64(600 * i, "s") for i in range(8)], dtype="datetime64[s]")

    def test_windows_basic_and_open_ends(self):
        mask = np.array([1, 1, 0, 0, 1, 0, 1, 1], dtype=bool)
        w = windows(mask, self.t, 600)
        self.assertEqual(len(w), 3)
        self.assertTrue(w[0]["open_start"] and not w[0]["open_end"])
        self.assertEqual(w[0]["hours"], 2 * 600 / 3600)
        self.assertEqual(w[0]["end"], "2026-11-14T00:20:00Z")
        self.assertFalse(w[1]["open_start"] or w[1]["open_end"])
        self.assertTrue(w[2]["open_end"])
        self.assertEqual(w[2]["end"], "2026-11-14T01:20:00Z")      # last sample + one step

    def test_no_windows(self):
        self.assertEqual(windows(np.zeros(8, bool), self.t, 600), [])
        self.assertEqual(hours(np.zeros(8, bool), 600), 0.0)

    def test_hours(self):
        self.assertAlmostEqual(hours(np.array([1, 1, 0, 1], bool), 600), 0.5)

    def test_next_change(self):
        mask = np.array([1, 1, 1, 0, 0, 0, 0, 0], dtype=bool)
        self.assertEqual(next_change(mask, self.t, "2026-11-14T00:05:00"), (True, 25.0))   # sunset at 00:30
        self.assertEqual(next_change(mask, self.t, "2026-11-14T00:40:00"), (False, None))
        with self.assertRaises(ValueError):
            next_change(mask, self.t, "2026-11-15T00:00:00")


@unittest.skipUnless(HAVE_DATA, "Horizons files not found")
class RealData(unittest.TestCase):
    def test_files_match_the_sites(self):
        """Azimuth of a polar body = (its sub-point longitude) - (site longitude).
        So subsolar and sub-Earth longitudes implied by each site's files must agree across sites."""
        sub_sun, sub_earth = [], []
        for sid, s in SITES.items():
            sun = load_track(os.path.join(HZ_DIR, f"sun_{sid}.csv"))
            earth = load_track(os.path.join(HZ_DIR, f"earth_{sid}.csv"))
            sub_sun.append((sun.az_deg[0] + s["lon"]) % 360)
            sub_earth.append(((earth.az_deg[0] + s["lon"] + 180) % 360) - 180)
        self.assertLess(max(sub_sun) - min(sub_sun), 0.5)
        self.assertLess(max(sub_earth) - min(sub_earth), 0.5)

    def test_sun_flag_matches_rule_where_it_can_be_tested(self):
        # R01 and R11: Sun is up all day, flag and rule agree trivially. R23: Sun is below the zero horizon
        # most of the day yet Horizons marks '*' on every step (see docs/decisions.md), so we do NOT claim a match there.
        for sid in ("R01", "R11"):
            sun, earth, _, flat, _ = run_site(sid, HZ_DIR, PROFILE_DIR)
            np.testing.assert_array_equal(flat.sun_up, np.array(["*" in f for f in sun.flags]))

    def test_regression_numbers(self):
        out = {}
        for sid in SITES:
            _, _, _, flat, terr = run_site(sid, HZ_DIR, PROFILE_DIR)
            out[sid] = (flat, terr)
        h = lambda m: round(float(m.sum()) / 6, 2)   # 10-minute steps -> hours
        self.assertEqual((h(out["R01"][0].sun_up), h(out["R01"][0].earth_up)), (24.17, 0.0))
        self.assertEqual((h(out["R11"][0].sun_up), h(out["R11"][0].earth_up)), (24.17, 0.0))
        self.assertEqual((h(out["R23"][0].sun_up), h(out["R23"][0].earth_up), h(out["R23"][0].both)), (4.83, 9.5, 4.83))
        self.assertEqual((h(out["R23"][1].sun_up), h(out["R23"][1].earth_up), h(out["R23"][1].both)), (14.67, 0.0, 0.0))

    def test_export_writes_files(self):
        import json, csv
        d = tempfile.mkdtemp()
        r = export_site("R23", HZ_DIR, PROFILE_DIR, d)
        self.assertTrue(os.path.exists(os.path.join(d, "R23.json")))
        with open(os.path.join(d, "R23_steps.csv")) as f:
            rows = list(csv.reader(f))
        self.assertEqual(len(rows), 146)
        self.assertEqual(len(rows[0]), len(rows[1]))
        with open(os.path.join(d, "R23.json")) as f:
            data = json.load(f)
        self.assertTrue(data["terrain_available"])
        self.assertIn("joint_windows", data["terrain"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
