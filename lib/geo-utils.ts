import type { Feature, Geometry } from "geojson";

export type MapBounds = [[number, number], [number, number]];

/** Prüft, ob eine Koordinate [lng, lat] innerhalb der MapBounds liegt. */
function isCoordInBounds(coord: number[], bounds: MapBounds): boolean {
  const [lng, lat] = coord;
  const [[south, west], [north, east]] = bounds;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

/** Beliebig tief verschachtelte Koordinatenstruktur (Position, Ring, Ringliste, Polygonliste). */
type CoordinateTree = number[] | CoordinateTree[];

function isAnyCoordInBounds(coords: CoordinateTree, bounds: MapBounds): boolean {
  // Position erkannt am ersten Element, nicht an der Länge: 3D-Koordinaten
  // [x, y, z] würden sonst als Liste durchlaufen und nie als "im Ausschnitt" gelten
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

/** Prüft eine Geometrie gegen den Kartenausschnitt; bei Linien/Flächen genügt ein Punkt innerhalb der Grenzen. */
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

/** Prüft, ob ein GeoJSON-Feature im Kartenausschnitt liegt (mind. eine Koordinate innerhalb). */
export function isFeatureInBounds(feature: Feature, bounds: MapBounds | null): boolean {
  if (!bounds || !feature.geometry) return true;
  return isGeometryInBounds(feature.geometry, bounds);
}
