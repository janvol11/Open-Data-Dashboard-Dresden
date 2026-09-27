// Typen für die Antwort der GovData-CKAN-API. Was dort oft fehlt, ist optional.

/** Datei oder Dienst eines Datensatzes (WFS, WMS, PDF …) */
export interface CKANResource {
  id: string;
  /** z.B. "WFS", "PDF", kann leer sein */
  format: string;
  url: string;
  name?: string;
  description?: string;
  mimetype?: string | null;
}

export interface CKANOrganization {
  id: string;
  /** z.B. "landeshauptstadt-dresden" */
  name: string;
  title: string;
  description?: string;
}

export interface CKANExtra {
  key: string;
  value: string;
}

export interface CKANPackage {
  id: string;
  name: string;
  title: string;
  /** Beschreibung (Markdown) */
  notes?: string | null;
  organization?: CKANOrganization | null;
  /** Freitext, oft gesetzt, wenn organization fehlt */
  maintainer?: string | null;
  maintainer_email?: string | null;
  resources?: CKANResource[];
  /** Hier steht oft publisher bzw. publisher_name */
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

// Aufbereitetes Format für das Frontend

export interface DresdenDataset {
  id: string;
  title: string;
  description: string;
  publisher: string;
  /** Bevorzugt ein WFS, sonst die erste Dienst-URL */
  wfsUrl: string | null;
  /** Alle Geodienst-URLs (WFS, WMS, GeoJSON, GML) */
  serviceUrls: string[];
  formats: string[];
  metadata_modified?: string;
}
