# Open Data Dashboard Dresden

Ein Dashboard, mit dem sich die offenen Geodaten der Landeshauptstadt Dresden auf einer Karte ansehen und auswerten lassen. Datensätze kommen aus dem GovData-Katalog oder direkt von den WFS-Diensten der Stadt, eigene CSV-Dateien lassen sich dazuladen. Das Projekt ist für den lokalen Betrieb gedacht.

## Funktionen

- Katalogsuche über die CKAN-API von GovData. Weil GovData bundesweit sammelt, filtert eine serverseitige Route die Treffer auf Dresdner Geodienste (mehr dazu unter [Andere Kommunen anbinden](#andere-kommunen-anbinden)).
- WFS-Dienste laden: Die Layer-Namen kommen aus `GetCapabilities`, die Daten per `GetFeature` (WFS 2.0.0, EPSG:4326, höchstens 1.000 Objekte). Liefert ein Dienst nur GML, wandelt der Proxy es in GeoJSON um.
- Karte auf Basis von Leaflet mit mehreren Layern gleichzeitig. Punkte lassen sich als Heatmap zeigen, Flächen und Punkte nach einem Attribut einfärben (Zahlen in Quantilklassen, sonst nach Kategorie).
- Ortssuche nach Adressen, Straßen und Stadtteilen über Nominatim.
- Auswertungen: Häufigkeiten, Zeitreihe, Korrelationsmatrix mit Streudiagramm, Qualitätsreport und Attributtabelle. Alles bezieht sich auf den sichtbaren Kartenausschnitt. Ein Klick auf einen Balken filtert zusätzlich Karte, Tabelle und die anderen Diagramme auf diesen Wert.
- Vorschläge: Nach dem Laden prüfen ein paar einfache Regeln Attribute und Geometrie und schlägt passende Darstellungen vor.
- Eigene CSV-Dateien: Die Geometrie wird aus Koordinatenspalten (`lat`/`lon`, `x`/`y` …) oder aus einer WKT/EWKT-Spalte (`shape`, `geom`, `the_geom` …) gelesen. CSVs ohne Geometrie landen als Tabelle in den Auswertungen und lassen sich über Stadtteil, Stadtbezirk oder statistischen Bezirk mit den Gebietsgrenzen der Stadt verknüpfen.
- Als Link sichern: Layer, Filter und Diagrammauswahl werden komprimiert in den URL-Hash geschrieben.

## Schnellstart

Voraussetzung ist Node.js ab Version 20.9 mit npm.

```bash
npm ci
npm run dev
```

Danach [http://127.0.0.1:3000](http://127.0.0.1:3000) im Browser öffnen. Für den Einstieg eignen sich die Datensätze unter „Highlights“ in der Seitenleiste.

Next.js schickt bei `dev` und `build` standardmäßig anonyme Nutzungsdaten an Vercel. Abschalten lässt sich das einmalig pro Rechner:

```bash
npx next telemetry disable
```

Alternativ vor dem Start die Umgebungsvariable `NEXT_TELEMETRY_DISABLED=1` setzen.

Weitere Skripte:

| Befehl | Zweck |
| --- | --- |
| `npm run build` und `npm run start` | Produktions-Build bauen und starten |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript-Prüfung (braucht die `next-env.d.ts`, die beim ersten `dev` oder `build` entsteht) |

## Datenquellen und Lizenzen

- Katalog: Metadaten von [GovData](https://www.govdata.de) über `ckan.govdata.de`.
- Geodaten: WFS-Dienste der Landeshauptstadt Dresden (`kommisdd.dresden.de`) sowie beliebige andere öffentliche WFS, die man selbst einträgt. Welche Lizenz für einen Datensatz gilt, steht beim jeweiligen Eintrag im Katalog. Wer Auswertungen weitergibt, sollte dort nachsehen und die Quelle nennen.
- Hintergrundkarte: Kacheln von `tile.openstreetmap.org`, © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), Daten unter ODbL. Es gilt die [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).
- Ortssuche: [Nominatim](https://nominatim.org), gesucht wird nur auf Enter, wie es die [Nutzungsbedingungen](https://operations.osmfoundation.org/policies/nominatim/) verlangen.

- Schriften: Geist und JetBrains Mono, beide unter der SIL Open Font License. Sie kommen als npm-Pakete (`geist`, `@fontsource-variable/jetbrains-mono`) und werden lokal ausgeliefert, auch der Build braucht keinen Zugriff auf Google Fonts.

Die Lizenz dieses Repositorys (siehe unten) gilt nur für den Code, nicht für die Daten.

## Datenschutz

Es gibt kein Konto und keine Datenbank. Trotzdem gehen Anfragen an Dritte:

- Der Browser lädt Kartenkacheln von OpenStreetMap und schickt Suchbegriffe der Ortssuche an Nominatim.
- Der lokale Next.js-Server fragt GovData, die WFS-Dienste der Stadt und bei der Katalogsuche die Metadaten-Server der Datensätze ab. Auch direkt eingegebene WFS-Adressen ruft er ab. Ein Schutz verhindert dabei Zugriffe auf private und interne Adressen (`lib/url-guard.ts`).
- CSV-Dateien werden im Browser gelesen und nicht hochgeladen.
- Im `localStorage` stehen nur das Farbschema, ob die Einführungstour schon gezeigt wurde und welche Vorschläge verworfen wurden.

## Grenzen

- Pro Datensatz werden höchstens 1.000 Objekte geladen, bei mehr SVG-Elementen wird die Karte träge. Das Baumkataster mit rund 124.000 Bäumen erscheint daher nur als Ausschnitt. Eine Leiste über den Diagrammen weist darauf hin.
- Ein geteilter Link zeigt auf `127.0.0.1`. Er funktioniert also nur bei jemandem, der das Dashboard selbst laufen hat. Lokale CSVs und Verknüpfungen stecken nicht im Link.
- Die Katalogsuche holt 500 Rohtreffer und filtert erst danach. Sehr allgemeine Begriffe können deshalb Dresdner Datensätze verpassen. Der Index kennt keine Wortstämme: „Spielplatz“ findet etwas, „Spiel“ nicht.
- Koordinaten werden nicht umprojiziert. WFS werden in EPSG:4326 angefragt, WKT in CSVs muss in WGS84 vorliegen.
- CSV-Dateien werden als UTF-8 gelesen. Exporte in einer anderen Kodierung zeigen falsche Umlaute.

## Projektaufbau

```
app/
  api/dresden-search/   Katalogsuche (GovData, serverseitig gefiltert)
  api/wfs-proxy/        Proxy für WFS-Abrufe inkl. GML → GeoJSON
  page.tsx              Seite mit Karte und Widgets
components/
  map/                  Leaflet-Karte, Heatmap, Legende, Ortssuche
  analytics/            Diagramme, Qualitätsreport, Attributtabelle
  sidebar/              Katalog, Highlights, Layer, Tabellen, Join-Dialog
lib/                    Datenlogik (WFS, CSV/WKT, Statistik, Join, SSRF-Schutz)
store/                  Globaler Zustand (zustand)
```

Verwendet werden Next.js 16 mit React 19 und TypeScript, Tailwind CSS, Leaflet mit leaflet.heat, Recharts, Zustand und Papa Parse. Alle Abhängigkeiten stehen unter Open-Source-Lizenzen (überwiegend MIT, ISC, Apache-2.0 und BSD).

## Andere Kommunen anbinden

Auf Dresden festgelegt ist nur die Katalogsuche. WFS-Proxy, Capabilities- und GetFeature-Auswertung, GML-Umwandlung, Karte, Auswertungen und CSV-Import arbeiten mit OGC-Standards und funktionieren für jede Kommune. Der SSRF-Schutz in `lib/url-guard.ts` hat bewusst **keine** Liste erlaubter Hosts: Er sperrt private und interne Adressen, lässt aber jeden öffentlichen Geodienst zu.

Einen fremden WFS kann man deshalb schon jetzt über „WFS direkt laden“ in der Seitenleiste einbinden. Getestet wurde das mit dem Baumkataster der Stadt Leipzig:

```
https://geodienste.leipzig.de/l3/OpenData/Baeume/wfs?service=wfs&request=GetCapabilities
```

Der Dienst meldet den Layer `OpenData:Baeume` und liefert über den Proxy Punkte samt Attributen wie `gattung`, `pflanzjahr` und `baumhoehe`.

### Was sich für die Katalogsuche ändern müsste

Für eine andere Kommune (oder eine Auswahl mehrerer) wäre vor allem `app/api/dresden-search/route.ts` zu parametrisieren:

| Stelle | Heute | Änderung |
| --- | --- | --- |
| CKAN-Query | `Dresden AND ({suchbegriff})` | Stadtname als Parameter |
| Herkunftsfilter | `orgName`, `orgTitle`, `maintainer`, `publisher` gegen `"dresden"` | gegen den gewählten Stadtnamen |
| Ersatz-Herausgeber | `"Landeshauptstadt Dresden"` | allgemein oder je Stadt |
| Cache-Schlüssel | `catalogCache.resolve(q, …)` | **muss die Stadt enthalten**, sonst kommen Treffer der zuvor gesuchten Kommune aus dem Cache |

Dazu kommen der zusätzliche Parameter in `lib/dresden-api.ts` und eine Auswahl in der Seitenleiste. Namen wie `DresdenDataset` oder die Route `dresden-search` müssten nicht geändert werden, sie sind nur Bezeichner.

Ein paar Punkte bleiben trotzdem Handarbeit:

- Die „Highlights“ (`components/sidebar/data-stories.tsx`) sind fest eingetragene Dresdner Dienste. Andere Kommunen bräuchten eine eigene Liste, oder der Bereich wird ausgeblendet.
- GovData-Einträge sind oft falsch zugeordnet. Leipzigs Baumkataster etwa steht unter der Organisation „Freistaat Sachsen“ und wird nur über das Feld `publisher` („Stadt Leipzig“) erkannt. Steht der Stadtname in keinem der vier Felder, fällt der Datensatz durchs Raster.
- Wie viel eine Suche findet, hängt am Volltextindex von CKAN und schwankt je nach Kommune.
- WFS-Server unterstützen unterschiedliche `outputFormat`-Werte. Ohne GeoJSON greift die GML-Umwandlung. Sie kann Punkte, Linien, Flächen (auch mit Löchern) und deren Multi-Varianten, aber nicht jede Sonderform.
- Die Verknüpfung von Tabellen mit Gebietsgrenzen (`lib/bezugsebenen.ts`) kennt nur Dresdner Ebenen.

## Lizenz

Der Code steht unter der [ISC-Lizenz](LICENSE). Für die Daten gelten die Lizenzen der jeweiligen Quellen (siehe [Datenquellen und Lizenzen](#datenquellen-und-lizenzen)).
