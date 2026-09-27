// Katalogsuche über die GovData-CKAN-API. Läuft serverseitig, weil
// ckan.govdata.de keine CORS-Header schickt.
//
// Den Dresden-Filter über fq zu machen klappt nicht zuverlässig: Viele Einträge
// hängen an der falschen Organisation (etwa "Freistaat Sachsen"). Deshalb holen
// wir 500 Treffer und filtern hier selbst.

import { NextResponse } from "next/server";
import { assertPublicUrl, fetchPublicUrl } from "@/lib/url-guard";
import { TtlCache } from "@/lib/ttl-cache";
import { readTextWithLimit, isTimeoutError } from "@/lib/http-utils";
import type {
  CKANPackage,
  CKANSearchResponse,
  DresdenDataset,
} from "@/types/dresden-data";

const CKAN_BASE_URL = "https://ckan.govdata.de/api/3/action";

/** guid wird später für den ISO-XML-Abruf gebraucht. */
interface FilteredPackage {
  dataset: DresdenDataset;
  guid: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;

const CATALOG_TIMEOUT_MS = 15_000;

/** Kurz, weil das Änderungsdatum nur nice-to-have ist. */
const REVISION_TIMEOUT_MS = 1500;

const MAX_REVISION_XML_BYTES = 2 * 1024 * 1024;

const MAX_QUERY_LENGTH = 200;

/** Pro Treffer gibt es einen ISO-XML-Abruf, daher nicht mehr als 50 je Seite. */
const MAX_ROWS = 50;

/** Suchbegriff → gefilterte Treffer */
const catalogCache = new TtlCache<FilteredPackage[]>(CACHE_TTL_MS, 50);

/** guid → Änderungsdatum aus dem ISO-XML */
const revisionDateCache = new TtlCache<string | null>(CACHE_TTL_MS, 1000);

/** Erster nicht leerer Wert zu einem der Schlüssel aus CKANs extras-Liste. */
function getExtraValue(
  extras: { key: string; value: string }[] | undefined,
  ...keys: string[]
): string {
  if (!extras || !Array.isArray(extras)) return "";
  for (const key of keys) {
    const entry = extras.find((e) => e.key === key);
    if (entry?.value) return entry.value;
  }
  return "";
}

function isGeoService(format: string, url: string): boolean {
  const GEO_KEYWORDS = ["wfs", "wms", "geojson", "gml", "wfs_srv", "wms_srv"];
  const fmtLower = format.toLowerCase();
  const urlLower = url.toLowerCase();
  return GEO_KEYWORDS.some(
    (kw) => fmtLower.includes(kw) || urlLower.includes(kw)
  );
}

function isWfsService(format: string, url: string): boolean {
  const WFS_KEYWORDS = ["wfs", "wfs_srv"];
  const fmtLower = format.toLowerCase();
  const urlLower = url.toLowerCase();
  return WFS_KEYWORDS.some(
    (kw) => fmtLower.includes(kw) || urlLower.includes(kw)
  );
}

// Solr-Sonderzeichen maskieren: "Bäume (Stadt" ist ungültige Syntax, und
// über "||" ließe sich die Dresden-Bedingung aushebeln.
function escapeSolr(term: string): string {
  return term.replace(/[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g, "\\$&");
}

/** Ganzzahl aus dem Query-String, auf [min, max] begrenzt. */
function parseBoundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/** Fehler von GovData, der Status geht an den Client durch. */
class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** Nur über catalogCache aufrufen. */
async function loadFilteredCatalog(q: string): Promise<FilteredPackage[]> {
  const params = new URLSearchParams({
    // Die Klammer ist wichtig: "Dresden AND a OR b" hieße "(Dresden AND a) OR b"
    q: `Dresden AND (${escapeSolr(q)})`,
    rows: "500", // nach dem Filtern bleiben meist nur 5 bis 20 übrig
  });

  const fetchUrl = `${CKAN_BASE_URL}/package_search?${params.toString()}`;

  // Kein Next.js-Cache: Die Antwort hat ~6 MB, das Limit dort liegt bei 2 MB.
  // Gecacht wird stattdessen das gefilterte Ergebnis (catalogCache).
  const response = await fetch(fetchUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });

  if (!response.ok) {
    console.error(`[Katalogsuche] GovData antwortete mit HTTP ${response.status}`);
    throw new UpstreamError(
      `GovData API-Fehler (HTTP ${response.status})`,
      response.status
    );
  }

  const data: CKANSearchResponse = await response.json();

  if (!data.success) {
    const ckanErr = data.error?.message || "Unbekannter CKAN-Fehler";
    console.error("[Katalogsuche] CKAN meldet einen Fehler:", ckanErr);
    throw new UpstreamError(`GovData meldete einen Fehler: ${ckanErr}`, 500);
  }

  const packages: CKANPackage[] = data.result?.results ?? [];

  return packages.reduce(
      (acc: FilteredPackage[], pkg: CKANPackage) => {
        // Herkunft: Die herausgebende Stelle steht je nach Eintrag in einem
        // dieser vier Felder
        const orgName = pkg.organization?.name?.toLowerCase() ?? "";
        const orgTitle = pkg.organization?.title?.toLowerCase() ?? "";
        const maintainer = pkg.maintainer?.toLowerCase() ?? "";
        const publisher = getExtraValue(
          pkg.extras,
          "publisher",
          "publisher_name"
        ).toLowerCase();

        const isFromDresden =
          orgName.includes("dresden") ||
          orgTitle.includes("dresden") ||
          maintainer.includes("dresden") ||
          publisher.includes("dresden");

        if (!isFromDresden) {
          return acc;
        }

        // Nur Einträge mit Geodienst, viele enthalten bloß PDFs oder Tabellen
        const serviceUrls: string[] = [];
        const formats = new Set<string>();
        let wfsUrl: string | null = null;

        for (const resource of pkg.resources ?? []) {
          const fmt = resource.format ?? "";
          const url = resource.url ?? "";

          if (fmt) formats.add(fmt.toUpperCase());

          if (isGeoService(fmt, url)) {
            serviceUrls.push(url);

            if (!wfsUrl && isWfsService(fmt, url)) {
              wfsUrl = url;
            }
          }
        }

        if (serviceUrls.length === 0) {
          return acc;
        }

        if (!wfsUrl) {
          wfsUrl = serviceUrls[0];
        }

        const displayPublisher =
          getExtraValue(pkg.extras, "publisher", "publisher_name") ||
          pkg.organization?.title ||
          "Landeshauptstadt Dresden";

        const actualModified =
          getExtraValue(pkg.extras, "modified") ||
          getExtraValue(pkg.extras, "issued") ||
          pkg.metadata_modified;

        const guid = getExtraValue(pkg.extras, "guid") || getExtraValue(pkg.extras, "uri");

        acc.push({
          dataset: {
            id: pkg.id,
            title: pkg.title || pkg.name || "Unbenannter Datensatz",
            description:
              pkg.notes?.trim() || "Keine Beschreibung im Katalog hinterlegt.",
            publisher: displayPublisher,
            wfsUrl,
            serviceUrls,
            formats: Array.from(formats),
            metadata_modified: actualModified,
          },
          guid
        });

        return acc;
      },
      []
    );
}

/**
 * Änderungsdatum aus dem originalen ISO-XML, oder null. Bei Timeout, Netz-
 * fehler oder 5xx wird geworfen, damit der Cache nicht eine Stunde lang
 * "kein Datum" speichert.
 */
async function loadRevisionDate(guid: string): Promise<string | null> {
  let safeUrl: URL;
  try {
    // Die guid kommt aus fremden Metadaten, also gleiche SSRF-Prüfung wie im Proxy
    safeUrl = await assertPublicUrl(guid);
  } catch {
    return null;
  }

  const res = await fetchPublicUrl(safeUrl, { signal: AbortSignal.timeout(REVISION_TIMEOUT_MS) });
  if (res.status >= 500) throw new Error(`ISO-XML nicht abrufbar (HTTP ${res.status})`);
  if (!res.ok) return null;

  const xml = await readTextWithLimit(res, MAX_REVISION_XML_BYTES);
    const match = xml.match(
      /<gmd:date>\s*<gco:Date>([^<]+)<\/gco:Date>\s*<\/gmd:date>\s*<gmd:dateType>\s*<gmd:CI_DateTypeCode[^>]*codeListValue="revision"/
    );
  return match?.[1] ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim().slice(0, MAX_QUERY_LENGTH);

  // Paginiert wird über die gefilterte Liste. Ein Offset an CKAN passt nicht,
  // weil erst unser Filter entscheidet, was übrig bleibt.
  const start = parseBoundedInt(searchParams.get("start"), 0, 0, 10000);
  const rows = parseBoundedInt(searchParams.get("rows"), MAX_ROWS, 1, MAX_ROWS);

  if (!q) {
    return NextResponse.json({ datasets: [], total: 0 });
  }

  try {
    // Cache je Suchbegriff (nicht je Seite), dann braucht "Mehr laden" keinen
    // neuen Abruf. CKAN unterscheidet keine Groß-/Kleinschreibung.
    const intermediateResults = await catalogCache.resolve(q.toLowerCase(), () =>
      loadFilteredCatalog(q)
    );

    const total = intermediateResults.length;
    const pageItems = intermediateResults.slice(start, start + rows);

    // Das modified-Feld überschreibt der GovData-Harvester bei jedem Lauf, das
    // echte Datum steht nur im ISO-XML der Quelle
    const mappedResults: DresdenDataset[] = await Promise.all(
      pageItems.map(async (item: FilteredPackage) => {
        if (!item.guid) return item.dataset;

        const revisionDate = await revisionDateCache
          .resolve(item.guid, () => loadRevisionDate(item.guid))
          .catch(() => null);

        return {
          ...item.dataset,
          metadata_modified: revisionDate ?? item.dataset.metadata_modified,
        };
      })
    );

    return NextResponse.json({ datasets: mappedResults, total });
  } catch (error: unknown) {
    if (error instanceof UpstreamError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isTimeoutError(error)) {
      return NextResponse.json(
        { error: "GovData hat nicht rechtzeitig geantwortet" },
        { status: 504 }
      );
    }
    console.error("Interner Serverfehler beim GovData-Abruf:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler bei der Katalogsuche" },
      { status: 500 }
    );
  }
}
