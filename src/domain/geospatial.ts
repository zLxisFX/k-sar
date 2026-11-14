export type StudyArea = {
  name: string;
  country: string;
  geographicCrs: "EPSG:4326";
};

export type RasterGrid = {
  width: number;
  height: number;
  crs: string;
  pixelSizeMeters: readonly [x: number, y: number];
  transform: readonly [
    columnX: number,
    rowX: number,
    originX: number,
    columnY: number,
    rowY: number,
    originY: number,
  ];
  noData: number | null;
};

export type EvidenceKind = "observation" | "surface-model" | "mapped-network";

export type DatasetScope = {
  id: string;
  name: string;
  evidence: EvidenceKind;
  interpretation: string;
  referenceGrid?: Pick<RasterGrid, "width" | "height" | "pixelSizeMeters">;
};
