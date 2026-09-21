"use client";

import { useState } from "react";
import { Loader2, MapPin, Search, X } from "lucide-react";

export interface PlaceResult {
  id: number;
  name: string;
  detail: string;
  lat: number;
  lon: number;
  /** [Süd, Nord, West, Ost] */
  bounds: [number, number, number, number];
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
/** Suchgebiet Dresden (West, Nord, Ost, Süd) – Treffer außerhalb werden verworfen. */
const DRESDEN_VIEWBOX = "13.579,51.178,13.966,50.974";

interface NominatimPlace {
  place_id: number;
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
  addresstype?: string;
  boundingbox: [string, string, string, string];
}

/** Deutsche Bezeichnung der Ortsart, damit gleichnamige Treffer unterscheidbar sind. */
const PLACE_TYPE_LABELS: Record<string, string> = {
  city_district: "Stadtbezirk",
  suburb: "Stadtteil",
  quarter: "Viertel",
  neighbourhood: "Wohngebiet",
  road: "Straße",
  square: "Platz",
  house: "Adresse",
  building: "Gebäude",
  amenity: "Einrichtung",
  shop: "Geschäft",
  tourism: "Sehenswürdigkeit",
  park: "Park",
  railway: "Bahnhof",
  village: "Ortschaft",
  hamlet: "Ortsteil",
};

/**
 * Orts- und Adresssuche über Nominatim (OpenStreetMap). Gesucht wird erst beim
 * Abschicken, nicht bei jedem Tastendruck: Die Nutzungsbedingungen von
 * Nominatim untersagen Autovervollständigung und erlauben höchstens eine
 * Anfrage pro Sekunde.
 */
export function PlaceSearch({ onSelect }: { onSelect: (place: PlaceResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q || isSearching) return;

    setIsSearching(true);
    setError(null);
    try {
      const url = new URL(NOMINATIM_URL);
      url.searchParams.set("q", q);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "6");
      url.searchParams.set("viewbox", DRESDEN_VIEWBOX);
      url.searchParams.set("bounded", "1");
      url.searchParams.set("accept-language", "de");

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Nominatim: ${response.status}`);
      const places = (await response.json()) as NominatimPlace[];
      setResults(places.map(toPlaceResult));
    } catch (err) {
      console.error("Ortssuche fehlgeschlagen", err);
      setResults(null);
      setError("Die Suche ist gerade nicht erreichbar. Bitte später erneut versuchen.");
    } finally {
      setIsSearching(false);
    }
  };

  const select = (place: PlaceResult) => {
    onSelect(place);
    setQuery(place.name);
    setResults(null);
  };

  const clear = () => {
    setQuery("");
    setResults(null);
    setError(null);
  };

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-1001 w-[min(22rem,calc(100%-7rem))]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        role="search"
        className="flex items-center gap-1.5 rounded-lg border bg-background/95 backdrop-blur px-2.5 shadow-sm focus-within:ring-2 focus-within:ring-ring"
      >
        {isSearching ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter direkt auswerten statt nur über das implizite Absenden des
            // Formulars – das greift etwa bei automatisierten Eingaben nicht
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            } else if (e.key === "Escape") {
              clear();
            }
          }}
          placeholder="Ort oder Adresse in Dresden suchen …"
          aria-label="Ort oder Adresse in Dresden suchen"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Suche leeren"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {(results || error) && (
        <div className="mt-1.5 overflow-hidden rounded-lg border bg-background shadow-md">
          {error && <p className="px-3 py-2.5 text-xs text-muted-foreground">{error}</p>}
          {results?.length === 0 && (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Nichts gefunden. Versuche es mit einem Stadtteil, einer Straße oder einem Ort in Dresden.
            </p>
          )}
          {results && results.length > 0 && (
            <ul>
              {results.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => select(place)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{place.name}</span>
                      {place.detail && (
                        <span className="block truncate text-xs text-muted-foreground">{place.detail}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t px-3 py-1 text-[10px] text-muted-foreground">Suche: © OpenStreetMap / Nominatim</p>
        </div>
      )}
    </div>
  );
}

function toPlaceResult(place: NominatimPlace): PlaceResult {
  // display_name ist sehr lang ("Pieschen, Dresden, Sachsen, 01127, Deutschland") –
  // Stadt, Bundesland, PLZ und Land sind bei einer Suche in Dresden überflüssig
  const parts = place.display_name
    .split(",")
    .map((p) => p.trim())
    .filter((p) => !/^(Dresden|Sachsen|Deutschland|\d{5})$/.test(p));
  const name = place.name || parts[0] || place.display_name;
  const typeLabel = place.addresstype ? PLACE_TYPE_LABELS[place.addresstype] : undefined;
  const detail = [typeLabel, ...parts.filter((p) => p !== name).slice(0, 3)].filter(Boolean).join(" · ");
  const [south, north, west, east] = place.boundingbox.map(Number);

  return {
    id: place.place_id,
    name,
    detail,
    lat: Number(place.lat),
    lon: Number(place.lon),
    bounds: [south, north, west, east],
  };
}
