import Papa from "papaparse";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import { toFiniteNumber } from "@/lib/stats-utils";
import { parseWkt, WKT_PATTERN } from "@/lib/wkt-utils";

const LAT_ALIASES = ["lat", "latitude", "y", "breite", "lat_wgs84"];
const LON_ALIASES = ["lon", "longitude", "lng", "x", "länge", "laenge", "lon_wgs84"];
const WKT_ALIASES = ["shape", "geom", "geometry", "the_geom", "wkt", "wkb_geometry"];

// WKT-Spalte erst am Namen suchen (Dresden nutzt "shape"), dann am Inhalt
function findWktColumn(headers: string[], sample: Record<string, unknown>): string | null {
  for (const header of headers) {
    if (WKT_ALIASES.includes(header.toLowerCase().trim()) && WKT_PATTERN.test(String(sample[header]))) {
      return header;
    }
  }
  for (const header of headers) {
    const value = sample[header];
    if (typeof value === "string" && WKT_PATTERN.test(value)) return header;
  }
  return null;
}

export async function parseCsvToGeoJson(file: File): Promise<FeatureCollection> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      // Kein dynamicTyping, der Stadtteil-Code "01" soll nicht zu 1 werden
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn("CSV parsing warnings:", results.errors);
        }

        const data = results.data as Record<string, unknown>[];
        if (data.length === 0) {
          return resolve({ type: "FeatureCollection", features: [] });
        }

        const headers = Object.keys(data[0]);
        let latCol: string | null = null;
        let lonCol: string | null = null;

        for (const header of headers) {
          const lower = header.toLowerCase().trim();
          if (!latCol && LAT_ALIASES.includes(lower)) latCol = header;
          if (!lonCol && LON_ALIASES.includes(lower)) lonCol = header;
        }

        const wktCol = findWktColumn(headers, data[0]);

        const features: Feature<Geometry | null>[] = data.map((row) => {
          let geometry: Geometry | null = null;

          if (latCol && lonCol) {
            // Mit Number() landeten leere Koordinaten bei [0, 0]
            const lat = toFiniteNumber(row[latCol]);
            const lon = toFiniteNumber(row[lonCol]);
            // Fängt vertauschte Spalten und UTM-Meter ab
            if (
              lat !== null && lon !== null &&
              lat >= -90 && lat <= 90 &&
              lon >= -180 && lon <= 180
            ) {
              geometry = {
                type: "Point",
                coordinates: [lon, lat],
              };
            }
          }

          // Sonst WKT, auch für einzelne Zeilen mit leeren Koordinaten
          if (!geometry && wktCol) {
            geometry = parseWkt(row[wktCol]);
          }

          return {
            type: "Feature",
            geometry,
            properties: row,
          };
        });

        resolve({
          type: "FeatureCollection",
          // Zeilen ohne Geometrie bleiben drin, sie zählen für die Auswertungen
          features: features as Feature[],
        });
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}
