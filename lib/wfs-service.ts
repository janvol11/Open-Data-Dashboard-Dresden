import { FeatureCollection } from "geojson";

// WFS-Zugriff über den eigenen Proxy (siehe app/api/wfs-proxy)
const WFS_PROXY_PATH = "/api/wfs-proxy";

/**
 * Obergrenze je GetFeature-Abruf; größere Datensätze kommen nur als Ausschnitt an.
 * Begrenzt wird wegen der Darstellung, nicht wegen des Dienstes: Die Karte
 * zeichnet jedes Objekt als SVG-Element und wird ab einigen tausend Punkten
 * träge.
 */
export const WFS_FEATURE_LIMIT = 1000;

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
  baseUrl.searchParams.set("count", String(WFS_FEATURE_LIMIT));

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

export interface WfsCapabilities {
  /** Layer-Namen (typeNames) in Reihenfolge der Capabilities */
  layerNames: string[];
  /** Lesbarer Titel je Layer-Name, sofern der Dienst einen liefert */
  layerTitles: Record<string, string>;
  /** Titel des Dienstes (ows:ServiceIdentification/ows:Title) */
  serviceTitle: string | null;
}

export async function fetchWfsCapabilities(wfsUrl: string): Promise<WfsCapabilities> {
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

  // Name und Title liegen im selben Namespace wie der FeatureType
  const childText = (el: Element, localName: string): string => {
    const node =
      el.getElementsByTagNameNS(WFS_NS, localName)[0] ??
      el.getElementsByTagNameNS(WFS1_NS, localName)[0] ??
      el.getElementsByTagName(localName)[0];
    return node?.textContent?.trim() ?? "";
  };

  const layerNames: string[] = [];
  const layerTitles: Record<string, string> = {};
  for (const ft of featureTypes) {
    const name = childText(ft, "Name");
    if (!name) continue;
    layerNames.push(name);
    const title = childText(ft, "Title");
    if (title) layerTitles[name] = title;
  }

  // WFS 1.1/2.x beschreiben den Dienst in ows:ServiceIdentification (OWS 1.0
  // bzw. 1.1, daher Namespace-unabhängig gesucht), WFS 1.0 in "Service"
  const serviceId =
    xmlDoc.getElementsByTagNameNS("*", "ServiceIdentification")[0] ??
    xmlDoc.getElementsByTagNameNS("*", "Service")[0];
  const serviceTitleNode = serviceId?.getElementsByTagNameNS("*", "Title")[0];
  const serviceTitle = serviceTitleNode?.textContent?.trim() || null;

  return { layerNames, layerTitles, serviceTitle };
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
