import { NextRequest, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { assertPublicUrl, fetchPublicUrl } from "@/lib/url-guard";
import { readTextWithLimit, isTimeoutError } from "@/lib/http-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Absichtlich ohne Access-Control-Allow-Origin. Das Frontend ruft den Proxy
// same-origin auf, fremde Seiten sollen ihn nicht als offenen Proxy nutzen.
const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Die Antworten kommen von fremden Servern, laufen aber unter unserer Origin.
// nosniff + CSP sandbox verhindern, dass eingeschleustes HTML/Script beim
// direkten Aufruf der Proxy-URL ausgeführt wird. fetch() stört das nicht.
const RESPONSE_HEADERS = {
  ...CORS_HEADERS,
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const UPSTREAM_ACCEPT =
  "application/json, application/geo+json, text/xml, application/xml, */*";

/** Gilt für den gesamten Abruf inkl. Body. */
const UPSTREAM_TIMEOUT_MS = 20_000;

/** Der Body wird komplett in den Speicher gelesen, daher die Obergrenze. */
const MAX_UPSTREAM_BYTES = 32 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json(
      { error: "Missing required 'url' parameter" },
      { status: 400, headers: RESPONSE_HEADERS }
    );
  }

  // SSRF-Schutz, siehe lib/url-guard.ts
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

    // JSON (z.B. GeoJSON) geht unverändert durch
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

    if (text.trimStart().startsWith("<")) {
      // Capabilities-XML reichen wir roh weiter, der Client parst es selbst.
      // Erkannt wird es am Inhalt, nicht am request-Parameter der URL, damit
      // darüber kein beliebiges Markup durchgereicht werden kann.
      const isCapabilities = /<(?:[\w-]+:)?(?:WFS_Capabilities|WMS_Capabilities|WMT_MS_Capabilities)\b/.test(text);

      if (isCapabilities) {
        return new NextResponse(text, {
          status: 200,
          headers: { ...RESPONSE_HEADERS, "Content-Type": "text/xml; charset=utf-8" },
        });
      }

      try {
        const geoJson = gmlToGeoJson(text);
        return NextResponse.json(geoJson, { status: 200, headers: RESPONSE_HEADERS });
      } catch (err) {
        // Details nur ins Serverlog, sie können Antwortausschnitte enthalten
        console.error("[WFS-Proxy] GML→GeoJSON conversion failed:", err);
        return NextResponse.json(
          { error: "GML konnte nicht in GeoJSON konvertiert werden" },
          { status: 422, headers: RESPONSE_HEADERS }
        );
      }
    }

    // Alles andere lehnen wir ab. Der fremde Content-Type soll nicht bestimmen,
    // was unter unserer Origin ausgeliefert wird.
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

// --- GML → GeoJSON ---

/** Geometrie-Elemente, mit oder ohne Namespace-Präfix. */
const GML_GEOMETRY_TAG =
  /^(?:[^:]+:)?(?:Point|MultiPoint|LineString|MultiLineString|Curve|MultiCurve|Polygon|Surface|MultiSurface|MultiPolygon)$/;

// Geometrie am Inhalt erkennen, nicht am Feldnamen. Namen wie "lage" oder
// "line" stecken auch in normalen Attributen ("Anlagenart", "online_status").
function isGeometryValue(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).some((k) => GML_GEOMETRY_TAG.test(k))
  );
}

/** "gml:Point" → "Point" */
function stripNs(key: string): string {
  return key.includes(":") ? key.split(":").slice(1).join(":") : key;
}

// Hat ein Element Attribute (<gml:posList srsDimension="2">), liefert der
// Parser ein Objekt mit "#text" statt eines Strings.
function nodeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const text = (value as Record<string, unknown>)["#text"];
    return text === null || text === undefined ? null : String(text);
  }
  return String(value);
}

/** XML-Attribut lesen (der Parser legt sie mit Präfix "@_" ab). */
function attr(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return value === null || value === undefined ? undefined : String(value);
}

/**
 * Liegen die Koordinaten als lat/lon vor? Bei URN/URL-Schreibweise von
 * EPSG:4326 ja (offizielle Achsreihenfolge). "EPSG:4326" und "epsg.xml#4326"
 * liefern Server in der Praxis als lon/lat. Ohne srsName gilt der Wert des
 * Elternelements.
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

/** Erster Geometrie-Knoten im Feature, notfalls rekursiv gesucht. */
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
 * pos/posList → [lon, lat]-Paare. dimension kommt aus srsDimension; bei 3D
 * wird die Höhe übersprungen.
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

function readPositions(value: unknown, latLon: boolean): [number, number][] {
  const text = nodeText(value);
  if (!text) return [];
  return parsePosString(text, latLon, Number(attr(value, "srsDimension") ?? 2));
}

function child(node: unknown, key: string): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
  const record = node as Record<string, unknown>;
  return record[`gml:${key}`] ?? record[key];
}

// Wiederholte Elemente liefert der Parser als Array, einzelne nicht
function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readPoint(point: unknown, latLon: boolean): [number, number] | null {
  const coords = readPositions(child(point, "pos"), latLon);
  if (coords.length > 0) return coords[0];

  // GML 2 ("x,y") ist immer lon/lat
  const coordText = nodeText(child(point, "coordinates"));
  if (coordText) {
    const parts = coordText.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 2 && parts.every((n) => !isNaN(n))) return [parts[0], parts[1]];
  }
  return null;
}

function readRing(boundary: unknown, latLon: boolean): [number, number][] {
  return readPositions(child(child(boundary, "LinearRing"), "posList"), latLon);
}

/** Außenring zuerst, danach die Löcher */
function readPolygonRings(polygon: unknown, latLon: boolean): [number, number][][] | null {
  const exterior = readRing(child(polygon, "exterior"), latLon);
  if (exterior.length === 0) return null;
  const holes = asArray(child(polygon, "interior"))
    .map((interior) => readRing(interior, latLon))
    .filter((ring) => ring.length > 0);
  return [exterior, ...holes];
}

function readSurfacePolygons(surface: unknown, latLon: boolean): [number, number][][][] {
  return asArray(child(child(surface, "patches"), "PolygonPatch"))
    .map((patch) => readPolygonRings(patch, latLon))
    .filter((rings): rings is [number, number][][] => rings !== null);
}

/** LineString oder Curve; die Segmente einer Curve werden aneinandergehängt. */
function readLine(line: unknown, latLon: boolean): [number, number][] {
  const direct = readPositions(child(line, "posList"), latLon);
  if (direct.length > 0) return direct;
  return asArray(child(child(line, "segments"), "LineStringSegment")).flatMap((segment) =>
    readPositions(child(segment, "posList"), latLon)
  );
}

function gmlGeomNodeToGeoJson(
  node: Record<string, unknown>,
  inheritedLatLon: boolean
): GeoJSON.Geometry | null {
  function get(key: string): unknown {
    const direct = child(node, key);
    if (direct !== undefined) return direct;
    const lk = key.toLowerCase();
    for (const [k, v] of Object.entries(node)) {
      if (stripNs(k).toLowerCase() === lk) return v;
    }
    return undefined;
  }

  const orderOf = (element: unknown, inherited = inheritedLatLon) =>
    isLatLonOrder(attr(element, "srsName"), inherited);

  const pointNode = get("Point");
  if (pointNode && typeof pointNode === "object") {
    const coordinates = readPoint(pointNode, orderOf(pointNode));
    if (coordinates) return { type: "Point", coordinates };
  }

  // Manche Server liefern pos ohne umschließendes Point
  const barePos = get("pos");
  if (barePos) {
    const coords = readPositions(barePos, orderOf(node));
    if (coords.length > 0) return { type: "Point", coordinates: coords[0] };
  }

  const multiPoint = get("MultiPoint");
  if (multiPoint && typeof multiPoint === "object") {
    const latLon = orderOf(multiPoint);
    const points = [
      ...asArray(child(multiPoint, "pointMember")),
      ...asArray(child(multiPoint, "pointMembers")),
    ]
      .flatMap((member) => asArray(child(member, "Point")))
      .map((point) => readPoint(point, orderOf(point, latLon)))
      .filter((p): p is [number, number] => p !== null);
    if (points.length > 0) return { type: "MultiPoint", coordinates: points };
  }

  const polygonNode = get("Polygon");
  if (polygonNode && typeof polygonNode === "object") {
    const rings = readPolygonRings(polygonNode, orderOf(polygonNode));
    if (rings) return { type: "Polygon", coordinates: rings };
  }

  const surfaceNode = get("Surface");
  if (surfaceNode && typeof surfaceNode === "object") {
    const polygons = readSurfacePolygons(surfaceNode, orderOf(surfaceNode));
    if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0] };
    if (polygons.length > 1) return { type: "MultiPolygon", coordinates: polygons };
  }

  // Mitglieder können Polygon oder Surface sein
  const multiSurface = get("MultiSurface") ?? get("MultiPolygon");
  if (multiSurface && typeof multiSurface === "object") {
    const latLon = orderOf(multiSurface);
    const members = [
      ...asArray(child(multiSurface, "surfaceMember")),
      ...asArray(child(multiSurface, "polygonMember")),
      ...asArray(child(multiSurface, "surfaceMembers")),
    ];
    const polygons = members.flatMap((member) => [
      ...asArray(child(member, "Polygon"))
        .map((polygon) => readPolygonRings(polygon, orderOf(polygon, latLon)))
        .filter((rings): rings is [number, number][][] => rings !== null),
      ...asArray(child(member, "Surface")).flatMap((surface) =>
        readSurfacePolygons(surface, orderOf(surface, latLon))
      ),
    ]);
    if (polygons.length > 0) return { type: "MultiPolygon", coordinates: polygons };
  }

  const lineNode = get("LineString") ?? get("Curve");
  if (lineNode && typeof lineNode === "object") {
    const coords = readLine(lineNode, orderOf(lineNode));
    if (coords.length > 1) return { type: "LineString", coordinates: coords };
  }

  const multiLine = get("MultiCurve") ?? get("MultiLineString");
  if (multiLine && typeof multiLine === "object") {
    const latLon = orderOf(multiLine);
    const lines = [
      ...asArray(child(multiLine, "curveMember")),
      ...asArray(child(multiLine, "lineStringMember")),
      ...asArray(child(multiLine, "curveMembers")),
    ]
      .flatMap((member) => [...asArray(child(member, "LineString")), ...asArray(child(member, "Curve"))])
      .map((line) => readLine(line, orderOf(line, latLon)))
      .filter((coords) => coords.length > 1);
    if (lines.length > 0) return { type: "MultiLineString", coordinates: lines };
  }

  return null;
}

function extractGeometry(
  feature: Record<string, unknown>,
  inheritedLatLon: boolean
): GeoJSON.Geometry | null {
  const geomNode = findGeometryNode(feature);
  if (!geomNode) return null;
  return gmlGeomNodeToGeoJson(geomNode, inheritedLatLon);
}

function extractProperties(feature: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(feature)) {
    const stripped = stripNs(key);
    if (key.startsWith("@_")) continue; // xmlns usw.
    if (isGeometryValue(value)) continue;
    if (value === null || value === undefined) {
      props[stripped] = null;
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // { "#text": "wert" } → "wert"
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

function gmlToGeoJson(gmlText: string): GeoJSON.FeatureCollection {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: true,
    // Führende Nullen erhalten: PLZ ("01069") und Stadtteil-Codes sind keine Zahlen
    numberParseOptions: { leadingZeros: false, hex: false, eNotation: false },
    trimValues: true,
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

  // Achsreihenfolge aus der Bounding-Box. Fehlt die Angabe, gilt lat/lon wie
  // bei WFS 1.1/2.0 mit EPSG:4326 vorgesehen.
  const boundedBy = (root["gml:boundedBy"] ?? root["boundedBy"]) as Record<string, unknown> | undefined;
  const envelope = boundedBy?.["gml:Envelope"] ?? boundedBy?.["Envelope"];
  const collectionLatLon = isLatLonOrder(attr(envelope, "srsName") ?? attr(root, "srsName"), true);

  // WFS 1.x: featureMember oder featureMembers (enthält die Features direkt),
  // WFS 2.0: wfs:member
  const rawMembers =
    root["gml:featureMember"] ??
    root["featureMember"] ??
    root["gml:featureMembers"] ??
    root["featureMembers"] ??
    root["wfs:member"] ??
    root["member"] ??
    [];

  const memberArray: unknown[] = Array.isArray(rawMembers) ? rawMembers : [rawMembers];

  const features: GeoJSON.Feature[] = [];

  for (const member of memberArray) {
    if (!member || typeof member !== "object") continue;

    const featureObj = member as Record<string, unknown>;

    const featureKeys = Object.keys(featureObj).filter((k) => !k.startsWith("@_"));
    if (featureKeys.length === 0) continue;

    for (const fKey of featureKeys) {
      const value = featureObj[fKey];
      for (const featureData of Array.isArray(value) ? value : [value]) {
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
  }

  // numberMatched durchreichen, damit das Frontend eine gekappte Antwort erkennt
  const matched = Number(attr(root, "numberMatched") ?? attr(root, "numberOfFeatures"));
  return {
    type: "FeatureCollection",
    features,
    ...(Number.isFinite(matched) && { numberMatched: matched }),
  } as GeoJSON.FeatureCollection;
}
