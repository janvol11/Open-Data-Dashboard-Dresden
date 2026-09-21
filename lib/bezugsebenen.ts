/**
 * Register der räumlichen Bezugsebenen, auf die sich Dresdner Statistiktabellen
 * beziehen (Stadtteil, Stadtbezirk/Ortschaft, Statistischer Bezirk, Stadtraum).
 *
 * Grundlage für den späteren Tabellen-Geometrie-Join: Ohne dieses Register
 * würde eine Join-Engine stillschweigend nur eine einzige Ebene bedienen –
 * dabei deckt allein "Stadtteil" nur einen kleinen Teil der Dresdner
 * Statistiktabellen ab. Jede Ebene braucht ihr eigenes Erkennungsmuster,
 * Schlüsselfeld und Normalisierungsverfahren; die Werte unten stammen aus
 * den echten Diensten (kommisdd.dresden.de) bzw. einer echten Dresdner
 * Statistiktabelle (Landtagswahl 1999ff.), nicht angenommen.
 */

// Unicode-Bereich der kombinierenden diakritischen Zeichen (0x0300–0x036F),
// über Zeichencodes statt als Literal im Quelltext – erspart Ärger mit
// Editor/Encoding an der Stelle, die eigentlich Umlaute robust machen soll.
const COMBINING_MARKS = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);

/** Entfernt Akzente/Umlaut-Diakritika für einen robusteren Namensabgleich (Schönfeld-Weißig ≈ schoenfeld-weissig nach NFD-Zerlegung). */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "");
}

/** Generische Namensnormalisierung: trimmen, Kleinschreibung, Diakritika glätten, Mehrfach-Leerzeichen zusammenfassen. */
function normalizeName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return stripDiacritics(trimmed.toLowerCase()).replace(/\s+/g, " ");
}

/** "01 Innere Altstadt" / "04 Wilsdruffer Vs./Seevs.-West" → "01"/"04" – Präfixnummer, auf 2 Stellen aufgefüllt. */
function normalizeStadtteilKey(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,3})/);
  if (!match) return null;
  return match[1].padStart(2, "0");
}

/**
 * "StB 3 Klotzsche/nördliche Ortschaften" → "klotzsche". Tabellen benennen
 * Stadtbezirke oft mit "StB <Nr> "-Präfix und hängen die administrativ
 * zugeordneten Ortschaften nach einem "/" oder "," an (z.B. "Cotta/westliche
 * Ortschaften") – für den Schlüsselvergleich zählt nur der Kernname davor.
 * Gegen die Landtagswahl-CSV und die Geometrie (NodeId 190) durchgetestet,
 * trifft zuverlässig.
 */
function normalizeStadtbezirkKey(raw: string): string | null {
  const withoutPrefix = raw.trim().replace(/^StB\s*\d+\s*/i, "");
  const core = withoutPrefix.split(/[/,]/)[0];
  return normalizeName(core);
}

export type KeyFormat = "numeric-code" | "name";

export interface GeometrySource {
  /** NodeId im kommisdd.dresden.de-WFS-Dienst. */
  nodeId: number;
  /** WFS-Layername aus GetCapabilities (kann sich theoretisch ändern, zuletzt geprüft s.u.). */
  typeName: string;
  /** Feld in der Geometrie, das den Schlüssel für den Join trägt. */
  keyField: string;
  /** Menschlich lesbares Namensfeld, für Anzeige und Fehlermeldungen. */
  nameField: string;
  /** Erwartete Objektanzahl – zur Plausibilitätsprüfung nach dem Laden (weicht sie ab, hat sich der Dienst geändert). */
  featureCount: number;
}

export interface Bezugsebene {
  id: string;
  label: string;
  /** Erkennungsmuster für Tabellen-Spaltennamen dieser Ebene. */
  columnPattern: RegExp;
  keyFormat: KeyFormat;
  /** Normalisiert einen rohen Tabellenwert auf das Vergleichsformat des Geometrie-Schlüssels; null bei nicht auswertbaren Werten. */
  normalizeKey: (raw: string) => string | null;
  /** null, wenn für diese Ebene keine Geometrie existiert (siehe Stadtraum). */
  geometry: GeometrySource | null;
  note?: string;
}

export const BEZUGSEBENEN: Bezugsebene[] = [
  {
    id: "stadtteil",
    label: "Stadtteil",
    columnPattern: /stadtteil/i,
    keyFormat: "numeric-code",
    normalizeKey: normalizeStadtteilKey,
    geometry: {
      nodeId: 188,
      typeName: "cls:L137",
      keyField: "blocknr",
      nameField: "bez",
      featureCount: 64,
    },
    note: "Join über die Nummer schlägt den Namen deutlich – Tabellen kürzen lange Stadtteilnamen gerne ab, was dem Namensabgleich Treffer kostet.",
  },
  {
    id: "stadtbezirk",
    label: "Stadtbezirk / Ortschaft",
    columnPattern: /stadtbezirk|ortsamt|ortschaft/i,
    keyFormat: "name",
    normalizeKey: normalizeStadtbezirkKey,
    geometry: {
      nodeId: 190,
      typeName: "cls:L139",
      keyField: "bez",
      nameField: "bez",
      featureCount: 19,
    },
    note: 'Ein gemeinsamer Layer für beide: 10 Objekte mit art="Stadtbezirk", 9 mit art="Ortschaft". Keine Nummer im Schlüsselfeld – nur Namensabgleich möglich.',
  },
  {
    id: "statistischer_bezirk",
    label: "Statistischer Bezirk",
    columnPattern: /statistische[rn]?\s*bezirk/i,
    keyFormat: "name",
    normalizeKey: normalizeName,
    geometry: {
      nodeId: 189,
      typeName: "cls:L138",
      keyField: "bez",
      nameField: "bez_lang",
      featureCount: 401,
    },
    note: "Trägt zugleich stadtteilnummer und stadtbezirk als eigene Attribute (401 Objekte rollen exakt auf die 64 Stadtteile bzw. 19 Stadtbezirke auf) – nutzbar, um eine feinere Tabelle auf eine gröbere Kartenebene aufzurollen, ohne den Namensabgleich der anderen Ebenen zu brauchen.",
  },
  {
    id: "stadtraum",
    label: "Stadtraum",
    columnPattern: /stadtraum/i,
    keyFormat: "name",
    normalizeKey: normalizeName,
    geometry: null,
    note:
      "Häufigste Bezugsebene im Katalog, aber ohne veröffentlichte Geometrie. Die 18 Namen (s. STADTRAUM_WERTE) schneiden quer zu Stadtteil und Stadtbezirk und enthalten von Fall zu Fall abweichende Ein-/Ausschlüsse " +
      '(z.B. "11 Prohlis, Reick (mit Sternhäuser, Am Koitschgraben)" vs. "12 … (ohne Sternhäuser, Am Koitschgraben)") – eine Stadtteil-Zuordnung lässt sich daraus nicht sicher ableiten und wird hier bewusst nicht geraten.',
  },
];

/**
 * Die 18 Stadtraum-Werte, wie sie in Dresdner Statistiktabellen vorkommen
 * (anhand der Landtagswahl-CSV abgeglichen, deckt sich weitgehend mit einer
 * zweiten, unabhängigen Tabelle). Ohne Geometriebezug nur zur
 * Erkennung/Validierung nutzbar, s. Hinweis bei "stadtraum" oben.
 */
export const STADTRAUM_WERTE = [
  "00 unbekannt",
  "01 StB Altstadt ohne Johannstadt",
  "02 Johannstadt",
  "03 StB Neustadt ohne Leipziger Vorstadt",
  "04 Leipziger Vorstadt, Pieschen",
  "05 Mickten, Kaditz, Trachau",
  "06 StB Klotzsche und nördliche OS",
  "07 StB Loschwitz und OS Schönfeld-Weißig",
  "08 Blasewitz, Striesen",
  "09 Tolkewitz, Seidnitz, Gruna",
  "10 StB Leuben",
  "11 Prohlis, Reick (mit Sternhäuser, Am Koitschgraben)",
  "12 Niedersedlitz, Leubnitz, Strehlen (ohne Sternhäuser, Am Koitschgraben)",
  "13 Südvorstadt, Zschertnitz",
  "14 Mockritz, Coschütz, Plauen",
  "15 Cotta, Löbtau, Naußlitz, Dölzschen",
  "16 Gorbitz",
  "17 Briesnitz und westliche OS",
] as const;

/** Findet die erste Bezugsebene, deren Erkennungsmuster auf den Spaltennamen passt, oder null. */
export function detectBezugsebene(columnName: string): Bezugsebene | null {
  return BEZUGSEBENEN.find((ebene) => ebene.columnPattern.test(columnName)) ?? null;
}
