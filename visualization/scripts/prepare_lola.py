"""Export heightmaps, a display map, and a local horizon from NASA PGDA 78."""
import argparse
import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import CRS, Transformer
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.windows import Window

RADIUS = 1737400
SITES = {'R01': (-137.49, -89.4632), 'R11': (-67.9321, -88.6834),
         'R23': (-0.2358, -85.9948), 'R06': (37.3667, -85.4381)}  # lon, lat; R23/R06 = centres of the LOLA tiles

def horizon(dem, data, project, lon, lat, z):
    lam, phi = np.radians([lon, lat])
    up = np.array([np.cos(phi)*np.cos(lam), np.cos(phi)*np.sin(lam), np.sin(phi)])
    east = np.array([-np.sin(lam), np.cos(lam), 0])
    north = np.cross(up, east)
    distance = np.arange(2.5, 23000, 2.5)
    cosine = np.cos(distance/RADIUS)[:, None]
    sine = np.sin(distance/RADIUS)[:, None]
    observer = (RADIUS+z+2)*up
    inverse = ~dem.transform
    for az in range(360):
        a = np.radians(az)
        unit = cosine*up + sine*(np.cos(a)*north + np.sin(a)*east)
        lam = np.degrees(np.arctan2(unit[:,1],unit[:,0]))
        phi = np.degrees(np.arcsin(np.clip(unit[:,2],-1,1)))
        col,row = inverse * project(lam,phi)
        col,row = np.floor(col).astype(int), np.floor(row).astype(int)
        inside = (row>=0)&(row<dem.height)&(col>=0)&(col<dem.width)
        heights = np.full(len(row),np.nan)
        heights[inside] = data[row[inside],col[inside]]
        gaps = np.flatnonzero(~np.isfinite(heights))
        n = gaps[0] if gaps.size else len(row)
        if not n:
            yield az,None,None,0
            continue
        ray = (RADIUS+heights[:n,None])*unit[:n]-observer
        vertical = ray@up
        el = np.degrees(np.arctan2(vertical,np.linalg.norm(ray-vertical[:,None]*up,axis=1)))
        k = np.argmax(el)
        yield az,float(el[k]),float(distance[k]),float(distance[n-1])

def run(site, source, output, width_m):
    lon,lat = SITES[site]
    number = site[1:]
    filename = f'Site{number}_final_adj_5mpp_surf.tif'
    with rasterio.open(source) as dem:
        crs = CRS.from_wkt(dem.crs.to_wkt())
        if dem.count!=1 or dem.shape[0]!=dem.shape[1] or not np.allclose(dem.res,[5,5]) or abs(crs.ellipsoid.semi_major_metre-RADIUS)>1:
            raise ValueError('Expected a square single-band 5 m PGDA LOLA GeoTIFF on the R=1737.4 km sphere.')
        project = Transformer.from_crs(crs.geodetic_crs,crs,always_xy=True).transform
        x,y = project(lon,lat)
        row,col = dem.index(x,y)
        pixels = width_m // 5
        half = pixels // 2
        window = Window(col-half,row-half,pixels,pixels)
        if min(window.row_off,window.col_off)<0 or window.row_off+pixels>dem.height or window.col_off+pixels>dem.width:
            raise ValueError('Site window is outside DEM.')
        output.mkdir(parents=True,exist_ok=True)
        scale,offset = dem.scales[0],dem.offsets[0]
        native = dem.window_transform(window)
        meta = {'site':site,'longitude_latitude_deg':[lon,lat],'xy_m':[x,y],
                'frame':'MOON_ME / DE421','crs_wkt':dem.crs.to_wkt(),
                'vertical_reference':'radial height in m above sphere R=1737400 m',
                'source_url':f'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site{number}/{filename}',
                'source_shape':list(dem.shape),'source_bounds_m':list(dem.bounds),
                'source_pixel_m':list(dem.res),'ground_m':float(dem.read(1,window=Window(col,row,1,1),masked=True).filled(np.nan)[0,0])*scale+offset,
                'source_nodata':str(dem.nodata),'mast_height_m':2,'heightmaps':{}}
        for size in (256,512,1024):
            method = Resampling.average if size<=pixels else Resampling.bilinear
            a = dem.read(1,window=window,out_shape=(size,size),masked=True,resampling=method).astype('float64').filled(np.nan)*scale+offset
            valid = np.isfinite(a)
            lo,hi = float(np.nanmin(a)),float(np.nanmax(a))
            step = (hi-lo)/65534 if hi>lo else 1
            codes = np.zeros(a.shape,np.uint16)
            codes[valid] = 1+np.rint((a[valid]-lo)/step).astype(np.uint16)
            Image.fromarray(codes).save(output/f'heightmap-{size}.png')
            meta['heightmaps'][str(size)] = {'min_m':lo,'step_m':step,'nodata_code':0,
                'affine':list(native*Affine.scale(pixels/size))[:6],'resampling':method.name}
            if size==512:
                dy,dx = np.gradient(a,width_m/size)
                shade = np.clip((dx+dy+1)/np.sqrt(3*(1+dx**2+dy**2)),0,1)
                gray = np.uint8(np.nan_to_num(shade)*255)
                alpha = np.uint8(valid)*255
                Image.fromarray(np.dstack([gray,gray,gray,alpha])).save(output/'hillshade.webp',lossless=True)
            if size==256:
                # The same projected grid can be used to construct a mesh.
                (output/'terrain.json').write_text(json.dumps({
                    'elevation_m':[[float(z) if np.isfinite(z) else None for z in r] for r in a],
                    'affine':meta['heightmaps'][str(size)]['affine']}))
        full = dem.read(1,masked=True).astype('float64').filled(np.nan)*scale+offset
        if not np.isfinite(full[row,col]):
            raise ValueError('Observer pixel is NoData.')
        with (output/'horizon.csv').open('w',newline='') as file:
            writer = csv.writer(file)
            writer.writerow(['az_deg','horizon_deg','obstacle_distance_m','coverage_m'])
            writer.writerows(horizon(dem,full,project,lon,lat,full[row,col]))
        (output/'metadata.json').write_text(json.dumps(meta,indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('site', choices=SITES)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument("--width-m", type=int, default=5000)
    args = parser.parse_args()
    if args.width_m < 10 or args.width_m % 10:
        parser.error("--width-m must be a positive multiple of 10 m")
    run(args.site,args.source,args.output,args.width_m)
