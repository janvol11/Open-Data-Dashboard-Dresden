import type { Feature, Geometry } from "geojson";

export type MapBounds = [[number, number], [number, number]];

function isCoordInBounds(coord: number[], bounds: MapBounds): boolean {
  const [lng, lat] = coord;
  const [[south, west], [north, east]] = bounds;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

type CoordinateTree = number[] | CoordinateTree[];

function isAnyCoordInBounds(coords: CoordinateTree, bounds: MapBounds): boolean {
  // Position am ersten Element erkennen, nicht an der Länge (3D hat drei Werte)
  if (typeof coords[0] === "number") {
    return isCoordInBounds(coords as number[], bounds);
  }
  for (const item of coords) {
    if (Array.isArray(item)) {
      if (isAnyCoordInBounds(item, bounds)) {
        return true;
      }
    }
  }
  return false;
}

/** Bei Linien und Flächen reicht ein Punkt im Ausschnitt. */
function isGeometryInBounds(geometry: Geometry, bounds: MapBounds): boolean {
  switch (geometry.type) {
    case "Point":
      return isCoordInBounds(geometry.coordinates, bounds);
    case "MultiPoint":
    case "LineString":
    case "MultiLineString":
    case "Polygon":
    case "MultiPolygon":
      return isAnyCoordInBounds(geometry.coordinates, bounds);
    case "GeometryCollection":
      return geometry.geometries.some((g) => isGeometryInBounds(g, bounds));
    default:
      return true;
  }
}

export function isFeatureInBounds(feature: Feature, bounds: MapBounds | null): boolean {
  if (!bounds || !feature.geometry) return true;
  return isGeometryInBounds(feature.geometry, bounds);
}
