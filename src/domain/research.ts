export type TransectSample = {
  lon: number;
  lat: number;
  distance_m: number;
  dsm_m: number | null;
  vv_base: number | null;
  vv_post: number | null;
  delta_vv: number | null;
};

export type ReferenceTransect = {
  id: string;
  distance_m: number;
  sample_count: number;
  samples: TransectSample[];
};

export type NisarRecord = {
  conceptId: string;
  granuleUr: string;
  acquisitionStart: string;
  acquisitionEnd: string;
  track: number;
  frame: number;
  direction: string;
  stackId: string;
  instrument: string;
  maturity: string;
  metadata: { path: string; sourceUrl: string };
  browse: {
    path: string;
    sourceUrl: string;
    width: number;
    height: number;
  };
};

export type CatalogFootprint = {
  id: string;
  geometry: { coordinates: number[][][] };
};
