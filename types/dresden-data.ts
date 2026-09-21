// TypeScript-Typen für die GovData-CKAN-API-Response. Alle Felder, die CKAN
// oft unvollständig oder nullable liefert, sind explizit mit '?' markiert.

/** Eine Ressource (Datei/Dienst) innerhalb eines CKAN-Pakets, z.B. WFS-Endpunkt, WMS-Dienst oder PDF. */
export interface CKANResource {
  id: string;
  /** Dateiformat, z.B. "WFS", "PDF", "GeoJSON". Kann leer sein. */
  format: string;
  url: string;
  name?: string;
  description?: string;
  /** MIME-Type, oft zuverlässiger als das format-Feld. */
  mimetype?: string | null;
}

/** Die CKAN-Organisation eines Pakets – zentrales Merkmal für den Dresden-Filter. */
export interface CKANOrganization {
  id: string;
  /** Maschinenlesbarer Name, z.B. "landeshauptstadt-dresden". */
  name: string;
  title: string;
  description?: string;
}

/** Ein Extra-Metadatum aus dem extras-Array (Key-Value-Paar, z.B. publisher, spatial, license_id). */
export interface CKANExtra {
  key: string;
  value: string;
}

/** Das vollständige CKAN-Paket (= Datensatz) aus der package_search-Antwort. */
export interface CKANPackage {
  id: string;
  /** Maschinenlesbarer Bezeichner, z.B. "baumkataster-dresden". */
  name: string;
  title: string;
  /** Beschreibung/Notizen in Markdown. Kann null sein. */
  notes?: string | null;
  organization?: CKANOrganization | null;
  /** Pflegeverantwortlicher als Freitext, oft befüllt wenn organization fehlt. */
  maintainer?: string | null;
  maintainer_email?: string | null;
  /** Fehlt bei unvollständig geharvesteten Einträgen gelegentlich ganz. */
  resources?: CKANResource[];
  /** Zusätzliche Metadaten als Key-Value-Array; 'publisher'/'publisher_name' sind hier oft versteckt. */
  extras?: CKANExtra[];
  tags?: { name: string; display_name?: string }[];
  metadata_modified?: string;
}

export interface CKANSearchResponse {
  success: boolean;
  result: {
    count: number;
    results: CKANPackage[];
  };
  error?: { message?: string };
}

// Internes, normalisiertes Datenmodell für das Dashboard-Frontend

/** Ein normalisierter Datensatz für die Dashboard-Sidebar, mit nur den vom Frontend benötigten Feldern. */
export interface DresdenDataset {
  id: string;
  title: string;
  description: string;
  publisher: string;
  /** Primäre WFS-URL; null, wenn kein dedizierter WFS-Endpunkt gefunden wurde (Fallback: serviceUrls[0]). */
  wfsUrl: string | null;
  /** Alle Geodienst-URLs (WFS, WMS, GeoJSON, GML) – mehrere pro Datensatz sind der Normalfall. */
  serviceUrls: string[];
  formats: string[];
  metadata_modified?: string;
}
