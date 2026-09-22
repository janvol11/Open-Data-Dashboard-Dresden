# Open Data Dashboard Dresden

Ein interaktives Dashboard zur Erkundung, Visualisierung und Analyse von Geodaten und offenen Datensätzen der Landeshauptstadt Dresden.

## Funktionen

- **Katalogsuche:** Anbindung an die GovData-CKAN-API über eine serverseitige Proxy-Route mit nachgelagertem Filter auf Dresdner Datensätze und Geodienste. GovData aggregiert bundesweit – der Zuschnitt auf Dresden entsteht erst im Post-Filter (siehe [Andere Kommunen anbinden](#andere-kommunen-anbinden)).
- **WFS-Integration:** Auswertung von `GetCapabilities` zur Ermittlung der Layer-Namen und Abruf per `GetFeature` (WFS 2.0.0, EPSG:4326, begrenzt auf 1.000 Objekte). Liefert ein Dienst kein GeoJSON, wandelt der Proxy das GML-Ergebnis um.
- **Interaktive Karte:** Leaflet-Kartenansicht mit mehreren gleichzeitigen Layern, Heatmap-Darstellung und thematischer Einfärbung (numerisch nach Quantilklassen, kategorisch nach Ausprägung).
- **Ortssuche:** Adressen, Straßen und Stadtteile in Dresden über Nominatim (OpenStreetMap) finden und direkt dorthin springen.
- **Visuelle Analysen:** Häufigkeitsverteilungen, Zeitreihen, Korrelationsmatrix mit Streudiagramm und Datenqualitätsbericht. Alle Auswertungen folgen dem Kartenausschnitt, ein Klick auf einen Balken der Verteilung filtert zusätzlich Karte, Tabelle und die übrigen Diagramme auf diesen Wert (Cross-Filtering).
- **Automatische Vorschläge:** Regelbasierte Auswertung von Attributen und Geometrie eines geladenen Datensatzes mit priorisierten Empfehlungen zur Darstellung.
- **Eigene Daten:** Import lokaler CSV-Dateien mit automatischer Erkennung der Geometrie – entweder aus getrennten Koordinatenspalten (`lat`/`lon`, `x`/`y` …) oder aus einer WKT/EWKT-Spalte (`shape`, `geom`, `the_geom` …), wie sie kommunale Exporte häufig verwenden.
- **Workspace teilen:** Layer, Filter und Diagrammauswahl werden komprimiert in den URL-Hash geschrieben und lassen sich als Link weitergeben.

## Technologien

- **Framework:** Next.js (App Router, React 19, TypeScript)
- **Styling:** Tailwind CSS, Lucide Icons, Motion
- **Karten & Geo:** Leaflet (direkt, ohne React-Wrapper), Turf.js, OpenStreetMap-Tiles
- **Diagramme:** Recharts
- **State Management:** Zustand

## Andere Kommunen anbinden

Das Dashboard ist nur in der Katalogsuche auf Dresden festgelegt. Alle datenführenden Teile – WFS-Proxy, `GetCapabilities`/`GetFeature`-Auswertung, GML→GeoJSON-Konvertierung, Karte, Analysen und CSV-Import – arbeiten ausschließlich mit OGC-Standards und sind bereits kommunenunabhängig. Insbesondere enthält der SSRF-Schutz in `lib/url-guard.ts` **keine** Host-Allowlist: Er blockt private und interne Adressen, lässt aber jeden öffentlich erreichbaren Geodienst zu.

Praktisch heißt das: Ein fremder WFS lässt sich schon heute über „WFS / WMS direkt laden" in der Sidebar einbinden. Getestet mit dem Baumkataster der Stadt Leipzig:

```
https://geodienste.leipzig.de/l3/OpenData/Baeume/wfs?service=wfs&request=GetCapabilities
```

Der Dienst meldet den Layer `OpenData:Baeume` und liefert über den unveränderten Proxy Punkt-Features bis zur Obergrenze samt Attributen (`gattung`, `pflanzjahr`, `baumhoehe` …).

### Was für die Katalogsuche zu ändern wäre

Um statt Dresden eine andere Kommune (oder mehrere zur Auswahl) durchsuchbar zu machen, ist im Wesentlichen `app/api/dresden-search/route.ts` zu parametrisieren:

| Stelle | Heute | Nötige Änderung |
| --- | --- | --- |
| CKAN-Query | `Dresden AND {suchbegriff}` | Stadtname aus Parameter |
| Herkunftsfilter | `orgName/orgTitle/maintainer/publisher` gegen `"dresden"` | gegen den gewählten Stadtnamen |
| Fallback-Herausgeber | `"Landeshauptstadt Dresden"` | generisch bzw. je Stadt |
| Cache-Schlüssel | `catalogCache.resolve(q, …)` | **muss die Stadt enthalten**, sonst liefert der Cache Treffer der zuvor gesuchten Kommune |

Dazu reicht das Durchreichen des Parameters in `lib/dresden-api.ts` und eine Auswahl in der Sidebar. Die Bezeichner (`DresdenDataset`, Routenname `dresden-search`) sind rein kosmetisch.

### Einschränkungen

- **Kuratierte Highlights:** Die Kacheln unter „Beliebte Datensätze" (`components/sidebar/data-stories.tsx`) sind fest hinterlegte Dresdner WFS-URLs. Für weitere Kommunen bräuchte jede eine eigene Liste, oder der Bereich wird ausgeblendet.
- **Katalogpflege:** Der Mehrfeld-Filter ist nötig, weil GovData-Einträge oft falsch zugeordnet sind – Leipzigs Baumkataster etwa steht unter der Organisation „Freistaat Sachsen" und wird nur über das `publisher`-Feld („Stadt Leipzig") erkannt. Datensätze, die den Stadtnamen in keinem der vier Felder führen, fallen durchs Raster.
- **Trefferqualität:** Die Ergebnisse hängen an CKANs Volltextindex, nicht am Code. Manche naheliegenden Begriffe liefern je nach Kommune unterschiedlich viel – der Index kennt keine Wortstammbildung.
- **Server-Eigenheiten:** WFS-Dienste unterscheiden sich in den unterstützten `outputFormat`-Werten. Liefert ein Server kein GeoJSON, greift die GML-Konvertierung des Proxys; exotische Geometrietypen deckt sie nicht vollständig ab.

## Lokale Entwicklung

### Voraussetzungen

- Node.js (v20.9+)
- npm

### Installation & Start

1. Repository klonen und Abhängigkeiten installieren:
   ```bash
   npm ci
   ```

2. Entwicklungsserver starten:
   ```bash
   npm run dev
   ```

3. Das Dashboard im Browser unter [http://127.0.0.1:3000](http://127.0.0.1:3000) öffnen.

## Build

Für den Produktions-Build:
```bash
npm run build
npm run start
```
