import { NextRequest, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { assertPublicUrl, fetchPublicUrl } from "@/lib/url-guard";
import { readTextWithLimit, isTimeoutError } from "@/lib/http-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kein "Access-Control-Allow-Origin: *": Der Proxy wird nur same-origin vom
// eigenen Frontend aufgerufen (siehe lib/wfs-service.ts). Ohne CORS-Freigabe
// kann ihn keine fremde Website als offenen HTTP-Proxy missbrauchen.
const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Der Proxy liefert fremde Inhalte unter der eigenen Origin aus. Ohne diese
// Header könnte ein Dienst HTML oder XHTML mit <script> einschleusen, das der
// Browser beim direkten Aufruf der Proxy-URL ausführt (XSS). "sandbox" und
// "default-src 'none'" stören den fetch()-Zugriff des Frontends nicht.
const RESPONSE_HEADERS = {
  ...CORS_HEADERS,
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// SSRF-Schutz: Der Proxy darf nur öffentlich erreichbare http(s)-Ziele
// ansprechen (siehe lib/url-guard.ts), sonst könnte "?url=" den Server zum
// Abruf interner Adressen zwingen.

const UPSTREAM_ACCEPT =
  "application/json, application/geo+json, text/xml, application/xml, */*";

/** Zeitlimit für den gesamten Abruf – verhindert, dass ein hängender Dienst dauerhaft einen Serverprozess belegt. */
const UPSTREAM_TIMEOUT_MS = 20_000;

/** Obergrenze für die Antwortgröße, da der Rumpf vollständig in den Speicher gelesen wird (GetFeature ist über WFS_FEATURE_LIMIT begrenzt). */
const MAX_UPSTREAM_BYTES = 32 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json(
      { error: "Missing required 'url' parameter" },
      { status: 400, headers: RESPONSE_HEADERS }
    );
  }

  let safeUrl: URL;
  try {
    safeUrl = await assertPublicUrl(targetUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ungültige URL" },
      { status: 400, headers: RESPONSE_HEADERS }
    );
  }

  try {
    const response = await fetchPublicUrl(safeUrl, {
      headers: { Accept: UPSTREAM_ACCEPT },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream WFS error: ${response.status} ${response.statusText}` },
        { status: response.status, headers: RESPONSE_HEADERS }
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await readTextWithLimit(response, MAX_UPSTREAM_BYTES);

    // Server liefert bereits JSON: unverändert durchreichen
    if (
      contentType.includes("json") ||
      text.trimStart().startsWith("{") ||
      text.trimStart().startsWith("[")
    ) {
      return new NextResponse(text, {
        status: 200,
        headers: { ...RESPONSE_HEADERS, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // Sonst GML/XML → GeoJSON konvertieren
    if (text.trimStart().startsWith("<")) {
      // GetCapabilities: XML unverändert durchreichen (Client parst mit DOMParser).
      // Erkannt nur am Inhalt, nicht an der URL – sonst ließe sich über
      // "?request=getcapabilities" beliebiges Markup durchschleusen
      const isCapabilities = /<(?:[\w-]+:)?(?:WFS_Capabilities|WMS_Capabilities|WMT_MS_Capabilities)\b/.test(text);

      if (isCapabilities) {
        return new NextResponse(text, {
          status: 200,
          headers: { ...RESPONSE_HEADERS, "Content-Type": "text/xml; charset=utf-8" },
        });
      }

      // GetFeature → GML zu GeoJSON konvertieren
      try {
        const geoJson = gmlToGeoJson(text);
        return NextResponse.json(geoJson, { status: 200, headers: RESPONSE_HEADERS });
      } catch (err) {
        // Genauer Fehler bleibt im Serverlog (kann interne Hostnamen/Antwortausschnitte enthalten)
        console.error("[WFS-Proxy] GML→GeoJSON conversion failed:", err);
        return NextResponse.json(
          { error: "GML konnte nicht in GeoJSON konvertiert werden" },
          { status: 422, headers: RESPONSE_HEADERS }
        );
      }
    }

    // Weder JSON noch XML: nicht durchreichen, sonst bestimmte der fremde
    // Dienst über seinen Content-Type, was unter der eigenen Origin läuft
    return NextResponse.json(
      { error: "Der Dienst lieferte ein nicht unterstütztes Antwortformat" },
      { status: 415, headers: RESPONSE_HEADERS }
    );
  } catch (error) {
    console.error("[WFS-Proxy] Fetch error:", error);
    const isTimeout = isTimeoutError(error);
    return NextResponse.json(
      {
        error: isTimeout
          ? "Der WFS-Dienst hat nicht rechtzeitig geantwortet"
          : "Failed to fetch from WFS service",
      },
      { status: isTimeout ? 504 : 502, headers: RESPONSE_HEADERS }
    );
  }
}

// GML → GeoJSON Konvertierung

/** GML-Elemente, die eine Geometrie tragen (mit oder ohne Namespace-Präfix). */
const GML_GEOMETRY_TAG =
  /^(?:[^:]+:)?(?:Point|MultiPoint|LineString|MultiLineString|Curve|MultiCurve|Polygon|Surface|MultiSurface|MultiPolygon)$/;

/**
 * Erkennt einen Geometrie-Knoten an seinem Inhalt statt am Feldnamen: Ein
 * Namensabgleich über Teilstrings ("lage", "line", "position") verwarf sonst
 * auch gewöhnliche Attribute wie "Anlagenart" oder "online_status".
 */
function isGeometryValue(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).some((k) => GML_GEOMETRY_TAG.test(k))
  );
}

/** Entfernt das XML-Namespace-Präfix, z.B. "gml:Point" → "Point". */
function stripNs(key: string): string {
  return key.includes(":") ? key.split(":").slice(1).join(":") : key;
}

/**
 * Liefert den Textinhalt eines Knotens. Trägt ein Element Attribute (z.B.
 * <gml:posList srsDimension="2">), legt der Parser ihn als Objekt mit
 * "#text" ab – String() ergäbe dann "[object Object]" und die Geometrie
 * ginge still verloren.
 */
function nodeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const text = (value as Record<string, unknown>)["#text"];
    return text === null || text === undefined ? null : String(text);
  }
  return String(value);
}

/** Liest ein XML-Attribut (Parser-Präfix "@_") eines Knotens. */
function attr(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return value === null || value === undefined ? undefined : String(value);
}

/**
 * Entscheidet anhand des srsName, ob die Koordinaten als Breite/Länge
 * vorliegen. URN- und URL-Schreibweisen von EPSG:4326 schreiben die
 * offizielle Achsreihenfolge (lat/lon) vor, die Kurzform "EPSG:4326" und die
 * alte "epsg.xml#4326"-Form liefern Server üblicherweise als lon/lat. Ohne
 * auswertbare Angabe gilt die geerbte Reihenfolge.
 */
function isLatLonOrder(srsName: string | undefined, inherited: boolean): boolean {
  if (!srsName) return inherited;
  const lower = srsName.toLowerCase();
  if (lower.includes("urn:ogc:def:crs:epsg") || lower.includes("opengis.net/def/crs/epsg")) {
    return /4326$/.test(lower);
  }
  if (/^epsg:\d+$/.test(lower) || lower.includes("epsg.xml#")) return false;
  return inherited;
}

/** Sucht rekursiv nach einem GML-Geometrie-Knoten innerhalb eines Feature-Objekts. */
function findGeometryNode(obj: Record<string, unknown>): Record<string, unknown> | null {
  for (const value of Object.values(obj)) {
    if (isGeometryValue(value)) return value as Record<string, unknown>;
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = findGeometryNode(value as Record<string, unknown>);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Parst einen GML pos/posList-String zu Koordinatenpaaren im GeoJSON-Format
 * [lon, lat]. `dimension` folgt dem srsDimension-Attribut, damit bei 3D-Daten
 * die Höhe übersprungen wird, statt die Paare gegeneinander zu verschieben.
 */
function parsePosString(posText: string, latLon: boolean, dimension = 2): [number, number][] {
  const nums = posText
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => !isNaN(n));
  const step = Number.isInteger(dimension) && dimension >= 2 ? dimension : 2;

  const coords: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += step) {
    coords.push(latLon ? [nums[i + 1], nums[i]] : [nums[i], nums[i + 1]]);
  }
  return coords;
}

/** Liest die Positionen eines pos-/posList-Knotens samt srsDimension-Attribut. */
function readPositions(value: unknown, latLon: boolean): [number, number][] {
  const text = nodeText(value);
  if (!text) return [];
  return parsePosString(text, latLon, Number(attr(value, "srsDimension") ?? 2));
}

/** Extrahiert ein GeoJSON-Geometrieobjekt aus einem GML-Geometrie-Knoten (Point, Polygon, MultiSurface, LineString). */
function gmlGeomNodeToGeoJson(
  node: Record<string, unknown>,
  inheritedLatLon: boolean
): GeoJSON.Geometry | null {
  function get(key: string): unknown {
    if (key in node) return node[key];
    for (const prefix of ["gml:"]) {
      if (prefix + key in node) return node[prefix + key];
    }
    const lk = key.toLowerCase();
    for (const [k, v] of Object.entries(node)) {
      if (stripNs(k).toLowerCase() === lk) return v;
    }
    return undefined;
  }

  /** Achsreihenfolge eines Elements: eigener srsName vor dem geerbten. */
  const orderOf = (element: unknown) => isLatLonOrder(attr(element, "srsName"), inheritedLatLon);

  // Point
  const pointNode = get("Point");
  if (pointNode && typeof pointNode === "object") {
    const pn = pointNode as Record<string, unknown>;
    const coords = readPositions(pn["gml:pos"] ?? pn["pos"], orderOf(pn));
    if (coords.length > 0) return { type: "Point", coordinates: coords[0] };

    // GML 2 ("x,y"): Achsreihenfolge ist hier immer lon/lat, kein Tausch
    const coordText = nodeText(pn["gml:coordinates"] ?? pn["coordinates"]);
    if (coordText) {
      const parts = coordText.trim().split(/[\s,]+/).map(Number);
      if (parts.length >= 2) return { type: "Point", coordinates: [parts[0], parts[1]] };
    }
  }

  // Bare pos auf oberster Ebene (manche Server betten pos direkt ein)
  const barePos = get("pos");
  if (barePos) {
    const coords = readPositions(barePos, orderOf(node));
    if (coords.length > 0) return { type: "Point", coordinates: coords[0] };
  }

  // Polygon
  const polygonNode = get("Polygon");
  if (polygonNode && typeof polygonNode === "object") {
    const pn = polygonNode as Record<string, unknown>;
    const exterior =
      (pn["gml:exterior"] ?? pn["exterior"]) as Record<string, unknown> | undefined;
    const ring = (exterior?.["gml:LinearRing"] ?? exterior?.["LinearRing"]) as
      | Record<string, unknown>
      | undefined;
    const coords = readPositions(ring?.["gml:posList"] ?? ring?.["posList"], orderOf(pn));
    if (coords.length > 0) return { type: "Polygon", coordinates: [coords] };
  }

  // MultiSurface / MultiPolygon
  const multiSurface = get("MultiSurface") ?? get("MultiPolygon");
  if (multiSurface && typeof multiSurface === "object") {
    const ms = multiSurface as Record<string, unknown>;
    const memberLatLon = orderOf(ms);
    const members = ms["gml:surfaceMember"] ?? ms["surfaceMember"] ?? ms["gml:polygonMember"] ?? ms["polygonMember"];
    const arr = Array.isArray(members) ? members : members ? [members] : [];
    const polygons = arr.map((m: unknown) => {
      const poly = (m as Record<string, unknown>)?.["gml:Polygon"] ?? (m as Record<string, unknown>)?.["Polygon"];
      if (!poly) return null;
      return gmlGeomNodeToGeoJson({ "gml:Polygon": poly }, memberLatLon);
    }).filter(Boolean);
    if (polygons.length) {
      return {
        type: "MultiPolygon",
        coordinates: polygons.map((p) => (p as GeoJSON.Polygon).coordinates),
      };
    }
  }

  // LineString
  const lineNode = get("LineString");
  if (lineNode && typeof lineNode === "object") {
    const ln = lineNode as Record<string, unknown>;
    const coords = readPositions(ln["gml:posList"] ?? ln["posList"], orderOf(ln));
    if (coords.length > 0) return { type: "LineString", coordinates: coords };
  }

  return null;
}

/** Extrahiert die GeoJSON-Geometrie aus einem WFS-Feature-Objekt. */
function extractGeometry(
  feature: Record<string, unknown>,
  inheritedLatLon: boolean
): GeoJSON.Geometry | null {
  const geomNode = findGeometryNode(feature);
  if (!geomNode) return null;
  return gmlGeomNodeToGeoJson(geomNode, inheritedLatLon);
}

/** Extrahiert die Nicht-Geometrie-Eigenschaften eines WFS-Feature-Objekts. */
function extractProperties(feature: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(feature)) {
    const stripped = stripNs(key);
    if (key.startsWith("@_")) continue; // XML-Attribute (xmlns etc.)
    if (isGeometryValue(value)) continue;
    if (value === null || value === undefined) {
      props[stripped] = null;
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // Einfache Ein-Wert-Objekte flach machen (z.B. { "#text": "value" })
      const inner = value as Record<string, unknown>;
      if ("#text" in inner) {
        props[stripped] = inner["#text"];
      } else {
        props[stripped] = JSON.stringify(value);
      }
    } else {
      props[stripped] = value;
    }
  }
  return props;
}

/** Wandelt eine GML FeatureCollection in eine GeoJSON FeatureCollection um. */
function gmlToGeoJson(gmlText: string): GeoJSON.FeatureCollection {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: true,
    // Führende Nullen sind bei Postleitzahlen und Gebietscodes bedeutungstragend
    // ("01069", Stadtteil-"blocknr") – ohne diese Optionen würde der Parser sie
    // unwiderruflich zu Zahlen machen (vgl. dynamicTyping in lib/csv-utils.ts)
    numberParseOptions: { leadingZeros: false, hex: false, eNotation: false },
    trimValues: true,
    // featureMember auch bei nur einem Element als Array behandeln
    isArray: (tagName) =>
      ["featureMember", "gml:featureMember", "featureMembers", "gml:featureMembers"].includes(tagName),
  });

  const xml = parser.parse(gmlText) as Record<string, unknown>;

  const root =
    (xml["wfs:FeatureCollection"] ??
      xml["FeatureCollection"] ??
      xml["wfs2:FeatureCollection"]) as Record<string, unknown> | undefined;

  if (!root) {
    const exception = xml["ows:ExceptionReport"] ?? xml["ExceptionReport"] ?? xml["ServiceExceptionReport"];
    if (exception) {
      throw new Error(`WFS Exception: ${JSON.stringify(exception)}`);
    }
    throw new Error("Unbekanntes GML-Format: Kein FeatureCollection-Root gefunden.");
  }

  // Standard-Achsreihenfolge der Antwort aus der Bounding-Box; ohne Angabe
  // bleibt es beim lat/lon-Tausch, den WFS 1.1.0/2.0 für EPSG:4326 vorsieht
  const boundedBy = (root["gml:boundedBy"] ?? root["boundedBy"]) as Record<string, unknown> | undefined;
  const envelope = boundedBy?.["gml:Envelope"] ?? boundedBy?.["Envelope"];
  const collectionLatLon = isLatLonOrder(attr(envelope, "srsName") ?? attr(root, "srsName"), true);

  // WFS 1.x nutzt featureMember (ggf. Array), WFS 2.x nutzt wfs:member
  const rawMembers =
    root["gml:featureMember"] ??
    root["featureMember"] ??
    (root["gml:featureMembers"] as Record<string, unknown> | undefined)?.["gml:featureMember"] ??
    (root["featureMembers"] as Record<string, unknown> | undefined)?.["featureMember"] ??
    root["wfs:member"] ??
    root["member"] ??
    [];

  const memberArray: unknown[] = Array.isArray(rawMembers) ? rawMembers : [rawMembers];

  const features: GeoJSON.Feature[] = [];

  for (const member of memberArray) {
    if (!member || typeof member !== "object") continue;

    // Jedes featureMember hat genau ein Kindelement (den eigentlichen Feature-Typ)
    const featureObj = member as Record<string, unknown>;

    const featureKeys = Object.keys(featureObj).filter((k) => !k.startsWith("@_"));
    if (featureKeys.length === 0) continue;

    for (const fKey of featureKeys) {
      const featureData = featureObj[fKey];
      if (!featureData || typeof featureData !== "object") continue;

      const fd = featureData as Record<string, unknown>;
      const geometry = extractGeometry(fd, collectionLatLon);
      const properties = extractProperties(fd);
      const fid = (fd["@_gml:id"] ?? fd["@_fid"] ?? null) as string | null;

      features.push({
        type: "Feature",
        id: fid ?? undefined,
        geometry: geometry as GeoJSON.Geometry,
        properties,
      });
    }
  }

  // Gesamtzahl des Dienstes mitgeben, damit das Frontend eine auf
  // WFS_FEATURE_LIMIT gekappte Antwort erkennt (siehe lib/wfs-service.ts)
  const matched = Number(attr(root, "numberMatched") ?? attr(root, "numberOfFeatures"));
  return {
    type: "FeatureCollection",
    features,
    ...(Number.isFinite(matched) && { numberMatched: matched }),
  } as GeoJSON.FeatureCollection;
}
