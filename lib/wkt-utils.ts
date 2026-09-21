import type { Geometry, Position } from "geojson";

/**
 * Minimaler WKT/EWKT-Parser für Geometriespalten in CSV-Exporten.
 *
 * Viele Open-Data-CSVs (u.a. die Biotoptypenkartierung Dresden) transportieren
 * die Geometrie nicht in getrennten lat/lon-Spalten, sondern als EWKT-String
 * der Form `SRID=4326;POINT(13.8966 51.0191)`.
 */

/** SRIDs, deren Koordinaten direkt als WGS84-Grad interpretiert werden dürfen. */
const WGS84_SRIDS = new Set([4326, 4979, 84]);

/** Erkennt, ob ein String überhaupt nach WKT/EWKT aussieht (für die Spaltensuche). */
export const WKT_PATTERN =
  /^\s*(?:SRID\s*=\s*\d+\s*;)?\s*(?:POINT|MULTIPOINT|LINESTRING|MULTILINESTRING|POLYGON|MULTIPOLYGON)\b/i;

/** Zerlegt an Kommas der obersten Klammerebene – verschachtelte Ringe bleiben intakt. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Entfernt genau eine umschließende Klammerebene, falls vorhanden. */
function unwrap(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith("(") && trimmed.endsWith(")")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

/** "13.8966 51.0191 120" → [13.8966, 51.0191]; Z/M-Werte werden verworfen. */
function parsePosition(text: string): Position | null {
  const tokens = unwrap(text).trim().split(/\s+/);
  if (tokens.length < 2) return null;

  const lon = Number(tokens[0]);
  const lat = Number(tokens[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  // Wertebereich prüfen, damit projizierte Koordinaten (z.B. UTM-Meter aus einer
  // fehlenden SRID-Angabe) nicht als Grad auf der Karte landen
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return [lon, lat];
}

/** Positionsliste: "1 2, 3 4" ebenso wie das MULTIPOINT-Format "(1 2), (3 4)". */
function parsePositions(text: string): Position[] | null {
  const positions: Position[] = [];
  for (const part of splitTopLevel(text)) {
    if (part.trim() === "") continue;
    const position = parsePosition(part);
    if (!position) return null;
    positions.push(position);
  }
  return positions.length > 0 ? positions : null;
}

/** Ringliste: "(1 2, 3 4), (5 6, 7 8)" → Position[][]. */
function parseRings(text: string): Position[][] | null {
  const rings: Position[][] = [];
  for (const part of splitTopLevel(text)) {
    if (part.trim() === "") continue;
    const ring = parsePositions(unwrap(part));
    if (!ring) return null;
    rings.push(ring);
  }
  return rings.length > 0 ? rings : null;
}

/**
 * Parst einen WKT/EWKT-String zu einer GeoJSON-Geometrie.
 * Gibt null zurück, wenn der Wert kein WKT ist, EMPTY ist, ungültige Zahlen
 * enthält oder in einem projizierten CRS vorliegt (das ohne Reprojektion
 * falsche Punkte auf der Karte erzeugen würde).
 */
export function parseWkt(raw: unknown): Geometry | null {
  if (typeof raw !== "string") return null;

  let text = raw.trim();
  if (text === "") return null;

  // EWKT-Präfix: SRID=4326;POINT(...)
  const sridMatch = text.match(/^SRID\s*=\s*(\d+)\s*;/i);
  if (sridMatch) {
    const srid = Number(sridMatch[1]);
    // SRID 0 = "unbekannt": zulassen und über die Wertebereichsprüfung absichern
    if (srid !== 0 && !WGS84_SRIDS.has(srid)) return null;
    text = text.slice(sridMatch[0].length).trim();
  }

  const typeMatch = text.match(/^([A-Za-z]+)\s*(.*)$/s);
  if (!typeMatch) return null;

  const type = typeMatch[1].toUpperCase();
  const rest = typeMatch[2].trim();

  if (/^EMPTY$/i.test(rest)) return null;
  if (!rest.startsWith("(") || !rest.endsWith(")")) return null;
  const body = unwrap(rest);

  switch (type) {
    case "POINT": {
      const coordinates = parsePosition(body);
      return coordinates ? { type: "Point", coordinates } : null;
    }
    case "MULTIPOINT": {
      const coordinates = parsePositions(body);
      return coordinates ? { type: "MultiPoint", coordinates } : null;
    }
    case "LINESTRING": {
      const coordinates = parsePositions(body);
      return coordinates ? { type: "LineString", coordinates } : null;
    }
    case "MULTILINESTRING": {
      const coordinates = parseRings(body);
      return coordinates ? { type: "MultiLineString", coordinates } : null;
    }
    case "POLYGON": {
      const coordinates = parseRings(body);
      return coordinates ? { type: "Polygon", coordinates } : null;
    }
    case "MULTIPOLYGON": {
      const polygons: Position[][][] = [];
      for (const part of splitTopLevel(body)) {
        if (part.trim() === "") continue;
        const rings = parseRings(unwrap(part));
        if (!rings) return null;
        polygons.push(rings);
      }
      return polygons.length > 0
        ? { type: "MultiPolygon", coordinates: polygons }
        : null;
    }
    default:
      return null;
  }
}
