import { FeatureCollection } from "geojson";

// WFS-Zugriff über den eigenen Proxy (siehe app/api/wfs-proxy)
const WFS_PROXY_PATH = "/api/wfs-proxy";

/** Obergrenze je GetFeature-Abruf; größere Datensätze kommen nur als Ausschnitt an. */
export const WFS_FEATURE_LIMIT = 500;

/**
 * Gesamtzahl der Objekte laut Dienst, sofern er sie mitliefert (WFS 2.0:
 * numberMatched, GeoServer: totalFeatures). Ohne Angabe null – dann lässt
 * sich eine Kappung nur daran erkennen, dass genau das Limit erreicht wurde.
 */
export function getMatchedFeatureCount(geoJson: FeatureCollection): number | null {
  const meta = geoJson as FeatureCollection & { numberMatched?: unknown; totalFeatures?: unknown };
  const total = Number(meta.numberMatched ?? meta.totalFeatures);
  return Number.isFinite(total) ? total : null;
}

export async function fetchWfsFeatures(wfsUrl: string, typeName?: string): Promise<FeatureCollection> {
  // ogcsl.ashx liefert bei Dresden direkt GeoJSON statt nur GML wie ogc.ashx
  const wfsEndpoint = wfsUrl.replace("/ogc.ashx", "/ogcsl.ashx");
  const baseUrl = new URL(wfsEndpoint);

  // Dresden-Server verlangt Großschreibung bei SERVICE/REQUEST
  baseUrl.searchParams.delete("Request");
  baseUrl.searchParams.delete("request");
  baseUrl.searchParams.delete("Service");
  baseUrl.searchParams.delete("service");
  baseUrl.searchParams.delete("SERVICE");
  baseUrl.searchParams.set("SERVICE", "WFS");
  baseUrl.searchParams.set("REQUEST", "GetFeature");
  baseUrl.searchParams.set("VERSION", "2.0.0");

  if (typeName) {
    baseUrl.searchParams.set("typeNames", typeName); // WFS 2.x: Plural
    baseUrl.searchParams.delete("typeName");
  }

  baseUrl.searchParams.set("outputFormat", "application/geo+json");
  baseUrl.searchParams.set("srsName", "EPSG:4326");
  baseUrl.searchParams.set("count", String(WFS_FEATURE_LIMIT)); // Timeouts bei großen Datensätzen vermeiden

  const proxyUrl = new URL(WFS_PROXY_PATH, window.location.origin);
  proxyUrl.searchParams.set("url", baseUrl.toString());

  const response = await fetch(proxyUrl.toString());

  if (!response.ok) {
    throw new Error(`WFS Error: ${response.status} ${response.statusText}`);
  }

  const textResponse = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(textResponse);
  } catch {
    throw new Error("WFS Service lieferte kein gültiges JSON-Format zurück. Möglicherweise unterstützt der Server nur GML/XML.");
  }

  // Gültiges JSON ist noch kein GeoJSON (z.B. eine Fehlermeldung des Dienstes);
  // ohne features-Array würden Karte und Auswertungen später abstürzen
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as FeatureCollection).features)) {
    throw new Error("WFS Service lieferte keine GeoJSON FeatureCollection zurück.");
  }
  return parsed as FeatureCollection;
}

export async function fetchWfsCapabilities(wfsUrl: string): Promise<string[]> {
  const baseUrl = new URL(wfsUrl);

  baseUrl.searchParams.set("Service", "WFS");
  baseUrl.searchParams.set("Request", "GetCapabilities");

  const proxyUrl = new URL(WFS_PROXY_PATH, window.location.origin);
  proxyUrl.searchParams.set("url", baseUrl.toString());

  const response = await fetch(proxyUrl.toString());

  if (!response.ok) {
    throw new Error(`WFS Capabilities Error: ${response.status} ${response.statusText}`);
  }

  const xmlText = await response.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

  // WFS 2.x nutzt "wfs:FeatureType", WFS 1.x nur "FeatureType"
  const WFS_NS = "http://www.opengis.net/wfs/2.0";
  const WFS1_NS = "http://www.opengis.net/wfs";

  let featureTypes = Array.from(xmlDoc.getElementsByTagNameNS(WFS_NS, "FeatureType"));
  if (featureTypes.length === 0) {
    featureTypes = Array.from(xmlDoc.getElementsByTagNameNS(WFS1_NS, "FeatureType"));
  }
  if (featureTypes.length === 0) {
    featureTypes = Array.from(xmlDoc.getElementsByTagName("FeatureType")); // Server ohne Namespace
  }

  return featureTypes.map(ft => {
    const nameNode =
      ft.getElementsByTagNameNS(WFS_NS, "Name")[0] ??
      ft.getElementsByTagNameNS(WFS1_NS, "Name")[0] ??
      ft.getElementsByTagName("Name")[0];
    return nameNode ? nameNode.textContent?.trim() ?? "" : "";
  }).filter(Boolean);
}

export function extractAttributes(geoJson: FeatureCollection): string[] {
  const attributes = new Set<string>();

  if (geoJson.features && geoJson.features.length > 0) {
    geoJson.features.forEach(feature => {
      if (feature.properties) {
        Object.keys(feature.properties).forEach(key => attributes.add(key));
      }
    });
  }

  return Array.from(attributes).sort();
}
