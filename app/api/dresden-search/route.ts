// Proxy und Filterschicht für die GovData-CKAN-API. ckan.govdata.de sendet
// keine CORS-Header, daher ruft diese Route den Katalog serverseitig ab.
//
// Gefiltert wird nachgelagert statt über CKANs Facetten-Query (fq): Viele
// GovData-Datensätze sind fehlerhaft katalogisiert (z.B. Organisation
// "Freistaat Sachsen" bei einem Dresdner Datensatz), daher werden 500
// Rohdatensätze geladen und anschließend serverseitig gefiltert.

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

/** Zwischenergebnis des Post-Filterings: gemappter Datensatz + guid für den späteren ISO-XML-Abruf. */
interface FilteredPackage {
  dataset: DresdenDataset;
  guid: string;
}

// Der Katalog ändert sich selten, eine Stunde Gültigkeit ist unkritisch
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Zeitlimit für den Katalogabruf – ohne Limit hinge die Suche, solange GovData nicht antwortet. */
const CATALOG_TIMEOUT_MS = 15_000;

/** Zeitlimit je ISO-XML-Abruf; das Änderungsdatum ist verzichtbar und darf die Trefferliste nicht aufhalten. */
const REVISION_TIMEOUT_MS = 1500;

/** Obergrenze für ein ISO-XML-Dokument, da es vollständig in den Speicher gelesen wird. */
const MAX_REVISION_XML_BYTES = 2 * 1024 * 1024;

/** Obergrenze für den Suchbegriff, bevor er in die CKAN-Query eingeht. */
const MAX_QUERY_LENGTH = 200;

/**
 * Obergrenze für Treffer je Seite. Pro Treffer wird ein ISO-XML-Dokument
 * abgerufen – höhere Werte würden entsprechend viele parallele Anfragen auslösen.
 */
const MAX_ROWS = 50;

/** Gefilterte Trefferliste je Suchbegriff. */
const catalogCache = new TtlCache<FilteredPackage[]>(CACHE_TTL_MS, 50);

/** Änderungsdatum je Datensatz-guid aus dem ISO-XML der Ursprungsquelle. */
const revisionDateCache = new TtlCache<string | null>(CACHE_TTL_MS, 1000);

/** Sucht in einem extras-Array (CKAN-Metadaten als {key, value}-Liste) den Wert zum ersten passenden Schlüssel. */
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

/** Prüft, ob eine Ressource zu einem Geodienst (WFS, WMS, GeoJSON, GML) gehört. */
function isGeoService(format: string, url: string): boolean {
  const GEO_KEYWORDS = ["wfs", "wms", "geojson", "gml", "wfs_srv", "wms_srv"];
  const fmtLower = format.toLowerCase();
  const urlLower = url.toLowerCase();
  return GEO_KEYWORDS.some(
    (kw) => fmtLower.includes(kw) || urlLower.includes(kw)
  );
}

/** Prüft speziell, ob eine Ressource ein WFS-Dienst ist. */
function isWfsService(format: string, url: string): boolean {
  const WFS_KEYWORDS = ["wfs", "wfs_srv"];
  const fmtLower = format.toLowerCase();
  const urlLower = url.toLowerCase();
  return WFS_KEYWORDS.some(
    (kw) => fmtLower.includes(kw) || urlLower.includes(kw)
  );
}

/**
 * Maskiert die Sonderzeichen der Solr-Query-Syntax, die CKAN intern verwendet.
 * Ohne Maskierung liefert z.B. "Bäume (Stadt" einen Syntaxfehler, und
 * Operatoren wie "||" hebeln die Verknüpfung mit "Dresden" aus.
 */
function escapeSolr(term: string): string {
  return term.replace(/[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g, "\\$&");
}

/** Liest einen ganzzahligen Query-Parameter mit Ober-/Untergrenze; leer/ungültig → fallback. */
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

/** Fehler eines vorgelagerten Dienstes, dessen Status durchgereicht wird. */
class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** Ruft den GovData-Katalog ab und gibt die gefilterten Dresdner Geodatensätze zurück. Nur über `catalogCache` aufrufen. */
async function loadFilteredCatalog(q: string): Promise<FilteredPackage[]> {
  const params = new URLSearchParams({
    // "Dresden AND ({q})", kein Anführungszeichen um Dresden (sonst Phrase-Matching);
    // die Klammer bindet den Suchbegriff als Ganzes an die Dresden-Bedingung,
    // sonst würde "a OR b" zu "(Dresden AND a) OR b"
    q: `Dresden AND (${escapeSolr(q)})`,
    rows: "500", // maximale Rohdaten, da nach dem Post-Filtering oft nur 5–20 übrig bleiben
  });

  const fetchUrl = `${CKAN_BASE_URL}/package_search?${params.toString()}`;

  // Bewusst ohne Next.js-Data-Cache: Antwort ist ~6 MB und liegt über dessen
  // 2-MB-Grenze. Zwischengespeichert wird stattdessen das Ergebnis dieser
  // Funktion (siehe catalogCache).
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

  // Föderale CKAN-Instanzen wie GovData aggregieren Datensätze aller
  // Bundesländer; die Volltextsuche liefert falsch-positive Treffer
  return packages.reduce(
      (acc: FilteredPackage[], pkg: CKANPackage) => {
        // Filter 1: Herkunft. Durchsucht werden alle Felder, in denen GovData
        // die herausgebende Stelle ablegt (case-insensitiv wegen variierender Schreibweisen)
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

        // Filter 2: Nur Datensätze mit Geodiensten (Katalogeinträge bündeln oft PDFs, Tabellen, WMS, WFS)
        const serviceUrls: string[] = [];
        const formats = new Set<string>();
        let wfsUrl: string | null = null;

        for (const resource of pkg.resources ?? []) {
          const fmt = resource.format ?? "";
          const url = resource.url ?? "";

          if (fmt) formats.add(fmt.toUpperCase());

          if (isGeoService(fmt, url)) {
            serviceUrls.push(url);

            // Erste WFS-URL als primäre URL bevorzugen (WFS > WMS > GeoJSON)
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
 * Ermittelt über das originale ISO-XML das tatsächliche Änderungsdatum eines
 * Datensatzes, oder null. Wirft bei vorübergehenden Fehlern (Timeout,
 * Netzfehler, HTTP 5xx), damit `revisionDateCache` sie nicht eine Stunde lang
 * als "kein Datum" festhält – gespeichert wird nur ein endgültiges Ergebnis.
 */
async function loadRevisionDate(guid: string): Promise<string | null> {
  let safeUrl: URL;
  try {
    // guid stammt aus CKAN-Metadaten (nicht kontrollierte Quelle) und durchläuft
    // deshalb dieselbe SSRF-Prüfung wie der WFS-Proxy
    safeUrl = await assertPublicUrl(guid);
  } catch {
    return null; // ungültige/interne URL: dauerhaft kein Datum
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

  // Paginierung läuft über die bereits gefilterte Ergebnismenge: Ein CKAN-Offset
  // würde Lücken/Dubletten erzeugen, da erst das Post-Filtering entscheidet,
  // welche Pakete Dresdner Geodienste sind
  const start = parseBoundedInt(searchParams.get("start"), 0, 0, 10000);
  const rows = parseBoundedInt(searchParams.get("rows"), MAX_ROWS, 1, MAX_ROWS);

  // Leere Anfragen direkt beantworten, ohne CKAN zu belasten
  if (!q) {
    return NextResponse.json({ datasets: [], total: 0 });
  }

  try {
    // Schlüssel ist der Suchbegriff, nicht die Seite: "Mehr laden" kommt
    // dadurch ohne erneuten Katalogabruf aus. Kleingeschrieben, da CKANs
    // Volltextsuche Groß-/Kleinschreibung nicht unterscheidet
    const intermediateResults = await catalogCache.resolve(q.toLowerCase(), () =>
      loadFilteredCatalog(q)
    );

    // Seitenzuschnitt vor dem ISO-XML-Abruf, da dieser pro Datensatz eine
    // eigene HTTP-Anfrage auslöst
    const total = intermediateResults.length;
    const pageItems = intermediateResults.slice(start, start + rows);

    // Reale Änderungsdaten nachladen: Der GovData-Harvester überschreibt
    // 'modified' systematisch, daher Auswertung des originalen ISO-XML
    const mappedResults: DresdenDataset[] = await Promise.all(
      pageItems.map(async (item: FilteredPackage) => {
        if (!item.guid) return item.dataset;

        // Vorübergehende Fehler nur für diese Antwort übergehen, ohne sie zu
        // speichern (siehe loadRevisionDate)
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
    // Genauer Fehler bleibt im Serverlog (kann interne Details enthalten)
    console.error("Interner Serverfehler beim GovData-Abruf:", error);
    return NextResponse.json(
      { error: "Interner Serverfehler bei der Katalogsuche" },
      { status: 500 }
    );
  }
}
