/**
 * Kleines Farb-Werkzeug für abgeleitete Kartenfarben: HEX↔HSL und ein
 * Generator für sequenzielle Rampen aus einer einzelnen Basisfarbe.
 */

/** Zerlegt einen #rgb/#rrggbb-Hexcode in HSL (h in Grad, s/l in Prozent). */
export function hexToHsl(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized.split("").map((c) => c + c).join("")
      : normalized;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    default: h = (r - g) / d + 4;
  }

  return [h * 60, s * 100, l * 100];
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

/** Baut aus HSL (h in Grad, s/l in Prozent) wieder einen #rrggbb-Hexcode. */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = s / 100;
  const ll = l / 100;

  if (ss === 0) {
    const v = Math.round(ll * 255);
    const hex = v.toString(16).padStart(2, "0");
    return `#${hex}${hex}${hex}`;
  }

  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;

  const toHex = (t: number) => Math.round(hueToRgb(p, q, t) * 255).toString(16).padStart(2, "0");

  return `#${toHex(hh + 1 / 3)}${toHex(hh)}${toHex(hh - 1 / 3)}`;
}

/**
 * Erzeugt eine sequenzielle Farbrampe aus einer Basisfarbe: hell nach dunkel
 * bei gleichbleibendem Farbton, mit wachsender Sättigung zu den dunklen
 * Klassen hin (sonst fällt dem Blick die helle, wenig gesättigte Klasse
 * zuerst auf, obwohl sie den niedrigsten Wert zeigt).
 *
 * Für numerisches Thematic Mapping: Jeder Layer bekommt eine Rampe in seiner
 * eigenen Farbe – bleibt bei mehreren aktiven Layern unterscheidbar und
 * liest sich trotzdem als echte Rangfolge (anders als eine Aneinanderreihung
 * distinkter Kategorienfarben).
 */
export function buildSequentialRamp(baseColor: string, steps: number): string[] {
  if (steps <= 0) return [];

  const [h, s] = hexToHsl(baseColor);
  const baseSat = Math.max(s, 45); // entsättigte Basisfarben (Grau) blieben sonst fahl

  if (steps === 1) return [hslToHex(h, baseSat, 40)];

  const LIGHT_L = 90;
  const DARK_L = 28;
  const LIGHT_S = Math.min(baseSat * 0.55, 55);
  const DARK_S = Math.min(baseSat * 1.15, 92);

  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1); // 0 (niedrigster Wert) … 1 (höchster Wert)
    const l = LIGHT_L + (DARK_L - LIGHT_L) * t;
    const sat = LIGHT_S + (DARK_S - LIGHT_S) * t;
    return hslToHex(h, sat, l);
  });
}
