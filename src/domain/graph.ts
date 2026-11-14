export type Coordinate = readonly [longitude: number, latitude: number];
type RoadNode = readonly [osmId: number, lon: number, lat: number, easting: number, northing: number];
type RoadEdge = readonly [from: number, to: number, key: number, lengthM: number, minimumDsmM: number | null, unknownSamples: number, geometry: number, name: string];
export type RoadGraphData = { schemaVersion: 1; nodes: RoadNode[]; edges: RoadEdge[]; geometries: Coordinate[][] };
export type RoadGraph = RoadGraphData & { adjacency: number[][]; heuristicScale: number };

/** Load original directed multiedges; no rounded distance or inferred connection. */
export function buildRoadGraph(data: RoadGraphData): RoadGraph {
  if (data.schemaVersion !== 1 || !data.nodes.length) throw new Error("Unsupported road graph schema.");
  const adjacency = Array.from({ length: data.nodes.length }, () => [] as number[]);
  const ids = new Set<number>();
  for (const node of data.nodes) {
    if (!Number.isSafeInteger(node[0]) || !node.every(Number.isFinite) || Math.abs(node[1]) > 180 || Math.abs(node[2]) > 90) throw new Error("Invalid road node.");
    if (ids.has(node[0])) throw new Error("Duplicate OSM node ID.");
    ids.add(node[0]);
  }
  let heuristicScale = 1;
  data.edges.forEach((edge, index) => {
    const [from, to, key, length, minimum, unknown, geometry] = edge;
    if (![from, to, key, unknown, geometry].every((value) => Number.isInteger(value) && value >= 0)
        || from >= data.nodes.length || to >= data.nodes.length || geometry >= data.geometries.length
        || !Number.isFinite(length) || length < 0 || (minimum !== null && !Number.isFinite(minimum))) throw new Error("Invalid road edge.");
    adjacency[from].push(index);
    const a = data.nodes[from], b = data.nodes[to];
    const straight = Math.hypot(a[3] - b[3], a[4] - b[4]);
    if (straight > 0) heuristicScale = Math.min(heuristicScale, length / straight);
  });
  for (const line of data.geometries) {
    if (line.length < 2 || line.some((p) => p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error("Invalid road geometry.");
  }
  return { ...data, adjacency, heuristicScale: heuristicScale * (1 - 1e-12) };
}

export function validateCoordinate(point: Coordinate): void {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new RangeError("Expected finite WGS84 longitude and latitude.");
}

/** Great-circle nearest-node snap; no road entrance is inferred. */
export function nearestRoadNode(graph: RoadGraph, coordinate: Coordinate): { index: number; distanceM: number } {
  validateCoordinate(coordinate);
  const rad = Math.PI / 180, [lon, lat] = coordinate;
  let index = 0, minimum = Infinity;
  graph.nodes.forEach((node, i) => {
    const dLat = (node[2] - lat) * rad, dLon = (node[1] - lon) * rad;
    const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(node[2] * rad) * Math.sin(dLon / 2) ** 2;
    const distance = 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, hav)));
    if (distance < minimum) { index = i; minimum = distance; }
  });
  return { index, distanceM: minimum };
}
