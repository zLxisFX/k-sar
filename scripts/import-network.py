"""Import the existing OSM graph and independently reproduce DSM edge sampling.

Requires the original Python environment: osmnx, numpy, shapely, pyproj, rasterio.
No geography or elevation is synthesized. Existing source files are read only.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import shutil
from email.utils import parsedate_to_datetime
from urllib.request import Request, urlopen
import numpy as np
import osmnx as ox
import rasterio
import shapely
from shapely.geometry import LineString
from shapely.ops import transform
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n', encoding='utf8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--legacy-root', type=Path, required=True)
    source = parser.parse_args().legacy_root.resolve() / 'data'
    dest = ROOT / 'data/network'
    dest.mkdir(parents=True, exist_ok=True)
    old = json.loads((source / 'terrain_manifest.json').read_text())
    for file, key in [('manila_roads.graphml', 'graph_sha256'), ('dem.tif', 'dem_sha256')]:
        if sha(source / file) != old[key]:
            raise ValueError(f'Original source hash mismatch: {file}')
    graph = ox.load_graphml(source / 'manila_roads.graphml')
    node_ids = list(graph.nodes)
    index = {n: i for i, n in enumerate(node_ids)}
    project = Transformer.from_crs(4326, 32651, always_xy=True)
    project_grid = Transformer.from_crs(4326, 3857, always_xy=True)
    nodes = []
    for n in node_ids:
        p = graph.nodes[n]
        x, y = project.transform(p['x'], p['y'])
        nodes.append([int(n), float(p['x']), float(p['y']), x, y])
    keys, geographic, projected = [], [], []
    for u, v, k, edge in graph.edges(keys=True, data=True):
        line = edge.get('geometry') or LineString([(graph.nodes[u]['x'], graph.nodes[u]['y']), (graph.nodes[v]['x'], graph.nodes[v]['y'])])
        keys.append((u, v, k))
        geographic.append(line)
        projected.append(transform(project_grid.transform, line))
    geoms = np.array(projected, dtype=object)
    lengths = shapely.length(geoms)
    counts = np.maximum(2, np.ceil(lengths / 15).astype(int) + 1)
    owners = np.repeat(np.arange(len(geoms)), counts)
    starts = np.r_[0, np.cumsum(counts)[:-1]]
    fractions = (np.arange(counts.sum()) - np.repeat(starts, counts)) / (counts[owners] - 1)
    points = shapely.line_interpolate_point(geoms[owners], fractions, normalized=True)
    regular = shapely.get_coordinates(points)
    vertices, vertex_owners = shapely.get_coordinates(geoms, return_index=True)
    with rasterio.open(source / 'dem.tif') as ds:
        dem = ds.read(1, masked=True).filled(np.nan)
        affine = ds.transform
        def sample(coords):
            cols = np.floor((coords[:, 0] - affine.c) / affine.a).astype(int)
            rows = np.floor((coords[:, 1] - affine.f) / affine.e).astype(int)
            valid = (cols >= 0) & (cols < ds.width) & (rows >= 0) & (rows < ds.height)
            heights = np.full(len(coords), np.inf, dtype=np.float32)
            heights[valid] = dem[rows[valid], cols[valid]]
            heights[~np.isfinite(heights)] = np.inf
            return heights
        heights, vertex_heights = sample(regular), sample(vertices)
    minimum = np.minimum.reduceat(heights, starts)
    np.minimum.at(minimum, vertex_owners, vertex_heights)
    unknown = np.add.reduceat((~np.isfinite(heights)).astype(int), starts)
    np.add.at(unknown, vertex_owners, (~np.isfinite(vertex_heights)).astype(int))
    original = np.load(source / 'road_dsm_index.npz')
    assert np.array_equal(original['keys'], np.array(keys))
    assert np.array_equal(original['minimum_m'], minimum), 'Fresh sampling must match original minima exactly'
    unique, lookup, edges = [], {}, []
    for i, (u, v, k) in enumerate(keys):
        coords = tuple(tuple(point) for point in geographic[i].coords)
        signature = min(coords, coords[::-1])
        if signature not in lookup:
            lookup[signature] = len(unique)
            unique.append(signature)
        edge = graph[u][v][k]
        name = edge.get('name', '')
        if isinstance(name, list): name = ' / '.join(map(str, name))
        if not isinstance(name, str): name = ''
        edges.append([index[u], index[v], int(k), float(edge['length']), float(minimum[i]) if np.isfinite(minimum[i]) else None, int(unknown[i]), lookup[signature], name])
    payload = {'schemaVersion': 1, 'nodes': nodes, 'edges': edges, 'geometries': unique}
    raw = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
    (dest / 'graph.json.gz').write_bytes(gzip.compress(raw, mtime=0))
    for old_name, new_name in [('hospitals.geojson', 'hospitals.geojson'), ('roads_display.geojson', 'roads-display.geojson'), ('osm_manifest.json', 'source-osm-manifest.json'), ('terrain_manifest.json', 'source-terrain-manifest.json')]:
        shutil.copy2(source / old_name, dest / new_name)
    hospitals = json.loads((dest / 'hospitals.geojson').read_text())['features']
    license_url = 'https://opendatacommons.org/licenses/odbl/1-0/'
    with urlopen(Request(license_url, headers={'User-Agent': 'K-SAR provenance importer'}), timeout=30) as response:
        license_bytes = response.read()
    if b'Open Database License' not in license_bytes:
        raise ValueError('Unexpected ODbL license response')
    (dest / 'odbl-1.0.html').write_bytes(license_bytes)
    clock_url = 'https://cmr.earthdata.nasa.gov/search/collections.json?page_size=1'
    with urlopen(Request(clock_url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'K-SAR provenance importer'}), timeout=30) as response:
        date = response.headers['Date']
    manifest = {
        'schemaVersion': 1, 'source': 'OpenStreetMap contributors via OSMnx/Overpass',
        'license': 'ODbL-1.0', 'sourceUrl': 'https://www.openstreetmap.org/copyright',
        'licenseUrl': license_url,
        'licenseFile': {'path': 'odbl-1.0.html', 'sourceUrl': license_url, 'sha256': sha(dest / 'odbl-1.0.html')},
        'provenance': 'Reused existing research graph, not a historical 2024 OSM snapshot; original source timestamps retained without claiming host clock accuracy.',
        'importedAt': parsedate_to_datetime(date).isoformat(), 'httpDate': date, 'timestampSource': clock_url,
        'counts': {'nodes': len(nodes), 'directedEdges': len(edges), 'hospitalFeatures': len(hospitals), 'edgesWithUnknownSamples': int((unknown > 0).sum()), 'geometries': len(unique)},
        'sourceHashes': {'graphml': old['graph_sha256'], 'dem': old['dem_sha256'], 'hospitals': sha(source / 'hospitals.geojson'), 'originalMinimumIndex': sha(source / 'road_dsm_index.npz')},
        'schema': {'nodes': ['osmId', 'longitude', 'latitude', 'eastingEPSG32651', 'northingEPSG32651'], 'edges': ['sourceNodeIndex', 'targetNodeIndex', 'multiedgeKey', 'lengthM', 'minimumDsmMEgm2008', 'unknownSampleCount', 'geometryIndex', 'name']},
        'dsmSampling': 'Every geometry vertex plus regular points at <=15 projected metres in EPSG:3857; nearest raster cell. Fresh Float32 minima exactly match original index.',
        'unknownPolicy': 'Scenario routing excludes an edge if any sample is missing/outside the raster; unknown is not called flooded. Baseline is topology-only.',
        'files': [{'path': name, 'bytes': (dest / name).stat().st_size, 'sha256': sha(dest / name)} for name in ['graph.json.gz', 'hospitals.geojson', 'roads-display.geojson', 'source-osm-manifest.json', 'source-terrain-manifest.json', 'odbl-1.0.html']],
        'limitations': ['OSM hospital-tagged features may include multiple features for one facility; capacity, operation and entrances are unverified.', 'DSM includes buildings/vegetation, not surveyed road elevation; bridges and barriers are not modeled.', 'Uniform EGM2008 water surface and uniform lowering are assumptions, not flood observations.', 'No-path result concerns only the selected OSM anchor on this graph.']}
    save(dest / 'manifest.json', manifest)
    print(json.dumps({'counts': manifest['counts'], 'files': manifest['files'], 'importedAt': manifest['importedAt']}))


if __name__ == '__main__':
    main()
