import type { DecodedRaster } from "@/domain/raster";
export type { Coordinate } from "@/domain/graph";
export type {
  RouteResponse,
  RoutingCatalog as RouteCatalog,
  ScenarioParameters as ScenarioInputs,
} from "@/domain/routing";
export type RasterSet = {
  baseline: DecodedRaster;
  post: DecodedRaster;
  dem: DecodedRaster;
};
