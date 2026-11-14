"""Registry of sites that have a terrain tile. A site not listed here is
computed against a flat sphere (terrain = no)."""

# name, short id from the Lunar Surface Data Book (Table A2.1-1, p.75), lat, lon, tile file
SITES = {
    "R01": {"name": "Connecting Ridge", "lat": -89.4632, "lon": -137.49, "tile": "Site01_final_adj_5mpp_surf.tif"},
    "R11": {"name": "de Gerlache Rim 1", "lat": -88.6834, "lon": -67.9321, "tile": "Site11_final_adj_5mpp_surf.tif"},
    "R23": {"name": "Malapert Massif", "lat": -85.9948, "lon": -0.23578, "tile": "Site23_final_adj_5mpp_surf.tif"},
}
