import json, math, os, sys, unittest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from calc.dem import Dem, latlon_to_xy, xy_to_latlon, load_geotiff, MOON_RADIUS_M
from calc.horizon import horizon_profile, blocked_by_terrain
from calc.sites import SITES

TILES = os.environ.get("TILES_DIR", os.path.expanduser("~/Downloads"))


def synthetic(lat, lon, half=6000.0, px=5.0, wall=None):
    """Flat DEM centred on the site. wall=(dx, dy, height): terrain raised by
    `height` where (x-x0)*dx + (y-y0)*dy >= 2000 (a plane-wall 2 km away)."""
    x0, y0 = latlon_to_xy(lat, lon)
    n = int(2 * half / px)
    dem = Dem(np.zeros((n, n), np.float32), x0 - half, y0 + half, px)
    if wall:
        dx, dy, hgt = wall
        xs = x0 - half + (np.arange(n) + 0.5) * px
        ys = y0 + half - (np.arange(n) + 0.5) * px
        X, Y = np.meshgrid(xs, ys)
        dem.heights[((X - x0) * dx + (Y - y0) * dy) >= 2000.0] = hgt
    return dem


class Projection(unittest.TestCase):
    def test_roundtrip(self):
        for lat, lon in [(-89.4632, -137.49), (-88.6834, -67.9321), (-85.9948, -0.23578), (-86.7, 150.0)]:
            la, lo = xy_to_latlon(*latlon_to_xy(lat, lon))
            self.assertAlmostEqual(la, lat, places=9)
            self.assertAlmostEqual(lo, lon, places=9)


class AzimuthConvention(unittest.TestCase):
    def test_matches_great_circle_bearing(self):
        """Ray direction used in horizon.py vs great-circle destination (bearing clockwise
        from north, longitude increasing east). Must agree within projection error."""
        for s in SITES.values():
            lat, lon = math.radians(s["lat"]), math.radians(s["lon"])
            x0, y0 = latlon_to_xy(s["lat"], s["lon"])
            lr = math.atan2(x0, y0)
            n = np.array([math.sin(lr), math.cos(lr)])
            e = np.array([math.cos(lr), -math.sin(lr)])
            for az in range(0, 360, 30):
                a, dr = math.radians(az), 5000.0 / MOON_RADIUS_M
                lat2 = math.asin(math.sin(lat) * math.cos(dr) + math.cos(lat) * math.sin(dr) * math.cos(a))
                lon2 = lon + math.atan2(math.sin(a) * math.sin(dr) * math.cos(lat),
                                        math.cos(dr) - math.sin(lat) * math.sin(lat2))
                gx, gy = latlon_to_xy(math.degrees(lat2), math.degrees(lon2))
                rx, ry = np.array([x0, y0]) + 5000.0 * (math.cos(a) * n + math.sin(a) * e)
                self.assertLess(math.hypot(gx - rx, gy - ry), 15.0)


class SyntheticHorizon(unittest.TestCase):
    def expected(self, hgt, d=2000.0):
        return math.degrees(math.atan2(hgt - d * d / (2 * MOON_RADIUS_M), d))

    def test_flat_is_level(self):
        p = horizon_profile(synthetic(-88.0, 30.0), -88.0, 30.0, radius_m=5000)
        self.assertLess(abs(p.angle_deg).max(), 0.01)

    def test_wall_angle_and_azimuth_at_lon0(self):
        # lon 0: local north = +y, east = +x
        for az, (dx, dy) in {0: (0, 1), 90: (1, 0), 180: (0, -1), 270: (-1, 0)}.items():
            dem = synthetic(-88.0, 0.0, wall=(dx, dy, 100.0))
            p = horizon_profile(dem, -88.0, 0.0, radius_m=5000)
            self.assertAlmostEqual(p.angle_deg[az], self.expected(100.0), delta=0.05, msg=f"az {az}")
            self.assertLess(abs(p.angle_deg[(az + 180) % 360]), 0.01)

    def test_azimuth_is_rotated_with_longitude(self):
        # lon 90: north = +x, east = -y. A wall to +x must show at azimuth 0, to -y at azimuth 90.
        for az, (dx, dy) in {0: (1, 0), 90: (0, -1), 180: (-1, 0), 270: (0, 1)}.items():
            dem = synthetic(-88.0, 90.0, wall=(dx, dy, 100.0))
            p = horizon_profile(dem, -88.0, 90.0, radius_m=5000)
            self.assertAlmostEqual(p.angle_deg[az], self.expected(100.0), delta=0.05, msg=f"az {az}")

    def test_coverage_limited_by_tile(self):
        p = horizon_profile(synthetic(-88.0, 30.0, half=3000.0), -88.0, 30.0, radius_m=20000)
        self.assertLessEqual(p.coverage_m.max(), 3000 * math.sqrt(2) + 10)
        self.assertGreater(p.coverage_m.min(), 2900)

    def test_outside_tile_raises(self):
        with self.assertRaises(ValueError):
            horizon_profile(synthetic(-88.0, 30.0), -80.0, 30.0)

    def test_blocked_by_terrain(self):
        dem = synthetic(-88.0, 0.0, wall=(1, 0, 100.0))   # wall to the east, ~2.8 deg
        p = horizon_profile(dem, -88.0, 0.0, radius_m=5000)
        self.assertTrue(blocked_by_terrain(p, 90.0, 2.0))
        self.assertFalse(blocked_by_terrain(p, 90.0, 4.0))
        self.assertFalse(blocked_by_terrain(p, 270.0, 0.5))
        self.assertFalse(blocked_by_terrain(p, 359.9, 0.5))   # wrap-around interpolation


@unittest.skipUnless(os.path.exists(os.path.join(TILES, "Site01_final_adj_5mpp_surf.tif")), "real tiles not found")
class RealTiles(unittest.TestCase):
    def test_site_is_at_tile_centre(self):
        for sid, s in SITES.items():
            path = os.path.join(TILES, s["tile"])
            if not os.path.exists(path):
                continue
            dem = load_geotiff(path)
            col, row = dem.xy_to_colrow(*latlon_to_xy(s["lat"], s["lon"]))
            self.assertAlmostEqual(float(col), dem.shape[1] / 2 - 0.5, delta=1.5, msg=sid)
            self.assertAlmostEqual(float(row), dem.shape[0] / 2 - 0.5, delta=1.5, msg=sid)

    def test_profiles_are_sane(self):
        for sid, s in SITES.items():
            path = os.path.join(TILES, s["tile"])
            if not os.path.exists(path):
                continue
            dem = load_geotiff(path)
            p = horizon_profile(dem, s["lat"], s["lon"], radius_m=20000)
            self.assertEqual(len(p.angle_deg), 360)
            self.assertTrue(np.isfinite(p.angle_deg).all())
            self.assertTrue(-10 < p.angle_deg.min() and p.angle_deg.max() < 45, sid)
            self.assertGreater(p.coverage_m.min(), 7900, sid)
            self.assertGreaterEqual(p.site_height_m, np.nanmin(dem.heights))
            self.assertLessEqual(p.site_height_m, np.nanmax(dem.heights))


if __name__ == "__main__":
    unittest.main(verbosity=2)
