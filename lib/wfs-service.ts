import { FeatureCollection } from "geojson";

const WFS_PROXY_PATH = "/api/wfs-proxy";

// Mehr als ~1.000 SVG-Elemente machen die Karte träge. Größere Datensätze
// kommen daher nur als Ausschnitt.
export const WFS_FEATURE_LIMIT = 1000;

/** Gesamtzahl laut Dienst (numberMatched bzw. totalFeatures bei GeoServer), sonst null. */
export function getMatchedFeatureCount(geoJson: FeatureCollection): number | null {
  const meta = geoJson as FeatureCollection & { numberMatched?: unknown; totalFeatures?: unknown };
  const total = Number(meta.numberMatched ?? meta.totalFeatures);
  return Number.isFinite(total) ? total : null;
}

const OGC_PARAM_KEYS = new Set([
  "service", "request", "version", "typename", "typenames",
  "outputformat", "srsname", "count", "maxfeatures",
]);

// OGC-Parameter sind case-insensitiv. Ohne das Aufräumen stünde z.B.
// "version=1.1.0" aus der Katalog-URL neben unserem "VERSION=2.0.0".
function stripOgcParams(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    if (OGC_PARAM_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
}

export async function fetchWfsFeatures(wfsUrl: string, typeName?: string): Promise<FeatureCollection> {
  const baseUrl = new URL(wfsUrl);

  // Dresdens ogcsl.ashx kann GeoJSON, ogc.ashx nur GML
  if (baseUrl.hostname === "kommisdd.dresden.de") {
    baseUrl.pathname = baseUrl.pathname.replace(/\/ogc\.ashx$/i, "/ogcsl.ashx");
  }

  const urlTypeName = [...baseUrl.searchParams].find(([key]) =>
    ["typename", "typenames"].includes(key.toLowerCase())
  )?.[1];

  // Der Dresdner Server will SERVICE/REQUEST in Großbuchstaben
  stripOgcParams(baseUrl);
  baseUrl.searchParams.set("SERVICE", "WFS");
  baseUrl.searchParams.set("REQUEST", "GetFeature");
  baseUrl.searchParams.set("VERSION", "2.0.0");

  const effectiveTypeName = typeName ?? urlTypeName;
  if (effectiveTypeName) {
    baseUrl.searchParams.set("typeNames", effectiveTypeName); // WFS 2.0: Plural
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

  // Auch Fehlermeldungen kommen als JSON, also auf features prüfen
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as FeatureCollection).features)) {
    throw new Error("WFS Service lieferte keine GeoJSON FeatureCollection zurück.");
  }
  return parsed as FeatureCollection;
}

export interface WfsCapabilities {
  /** typeNames in der Reihenfolge der Capabilities */
  layerNames: string[];
  /** Titel je Layer, falls vorhanden */
  layerTitles: Record<string, string>;
  serviceTitle: string | null;
}

export async function fetchWfsCapabilities(wfsUrl: string): Promise<WfsCapabilities> {
  const baseUrl = new URL(wfsUrl);

  stripOgcParams(baseUrl);
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

  const WFS_NS = "http://www.opengis.net/wfs/2.0";
  const WFS1_NS = "http://www.opengis.net/wfs";

  let featureTypes = Array.from(xmlDoc.getElementsByTagNameNS(WFS_NS, "FeatureType"));
  if (featureTypes.length === 0) {
    featureTypes = Array.from(xmlDoc.getElementsByTagNameNS(WFS1_NS, "FeatureType"));
  }
  if (featureTypes.length === 0) {
    featureTypes = Array.from(xmlDoc.getElementsByTagName("FeatureType")); // ohne Namespace
  }

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

  // WFS 1.1/2.0: ows:ServiceIdentification (OWS-Version variiert), WFS 1.0: Service
  const serviceId =
    xmlDoc.getElementsByTagNameNS("*", "ServiceIdentification")[0] ??
    xmlDoc.getElementsByTagNameNS("*", "Service")[0];
  const serviceTitleNode = serviceId?.getElementsByTagNameNS("*", "Title")[0];
  const serviceTitle = serviceTitleNode?.textContent?.trim() || null;

  return { layerNames, layerTitles, serviceTitle };
}
