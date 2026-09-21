import Papa from "papaparse";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import { toFiniteNumber } from "@/lib/stats-utils";
import { parseWkt, WKT_PATTERN } from "@/lib/wkt-utils";

const LAT_ALIASES = ["lat", "latitude", "y", "breite", "lat_wgs84"];
const LON_ALIASES = ["lon", "longitude", "lng", "x", "länge", "laenge", "lon_wgs84"];
const WKT_ALIASES = ["shape", "geom", "geometry", "the_geom", "wkt", "wkb_geometry"];

/**
 * Sucht die Spalte mit der WKT/EWKT-Geometrie: erst über bekannte Spaltennamen,
 * danach als Fallback über den Inhalt (Dresdner CSV-Exporte nutzen "shape",
 * andere Portale benennen die Spalte beliebig).
 */
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

/** Parst eine CSV-Datei zu einer GeoJSON FeatureCollection und erkennt Koordinaten- bzw. Geometriespalten automatisch. */
export async function parseCsvToGeoJson(file: File): Promise<FeatureCollection> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      // Kein dynamicTyping: Papa würde "01" sonst schon beim Parsen
      // unwiderruflich zu 1 machen – führende Nullen sind bei Schlüsseln wie
      // Stadtteil-Codes bedeutungstragend. toFiniteNumber() weiter unten
      // wandelt bei Bedarf trotzdem sicher in Zahlen um, ohne den Rohwert zu verlieren.
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
            // toFiniteNumber statt Number(): Number(null) wäre 0 und würde eine
            // fehlende Koordinate als Punkt [0, 0] auf der Karte erscheinen lassen
            const lat = toFiniteNumber(row[latCol]);
            const lon = toFiniteNumber(row[lonCol]);
            // Wertebereich prüfen, um vertauschte Spalten oder projizierte
            // Koordinaten (z.B. UTM-Meter) auszuschließen
            if (
              lat !== null && lon !== null &&
              lat >= -90 && lat <= 90 &&
              lon >= -180 && lon <= 180
            ) {
              geometry = {
                type: "Point",
                coordinates: [lon, lat], // GeoJSON: [longitude, latitude]
              };
            }
          }

          // Fallback auf die WKT-Spalte: greift bei Exporten ohne lat/lon-Spalten
          // und bei einzelnen Zeilen, deren Koordinatenfelder leer sind
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
          // Zeilen ohne erkennbare Koordinaten behalten eine null-Geometrie:
          // Sie bleiben für die Attributauswertung nutzbar, erscheinen aber nicht auf der Karte
          features: features as Feature[],
        });
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}
