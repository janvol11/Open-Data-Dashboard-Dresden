// SSRF-Schutz für alle serverseitigen Abrufe fremdbestimmter URLs. Ohne diese
// Prüfung könnte eine Ziel-URL aus einer nicht kontrollierten Quelle (Query-
// Parameter, Katalog-Metadaten) den Server zum Abruf interner Adressen
// zwingen (localhost, private Netze, Cloud-Metadaten-Dienste).
// Nur serverseitig verwendbar (node:dns, node:net) – nicht in Client-Code importieren.

import dns from "node:dns/promises";
import net from "node:net";

export const MAX_REDIRECTS = 5;

/**
 * Zerlegt eine IPv6-Adresse in acht 16-Bit-Gruppen (inkl. "::"-Kurzschreibweise
 * und eingebetteter IPv4-Notation), damit dieselbe Adresse nicht über eine
 * andere Schreibweise an der Prüfung vorbeigeschleust werden kann.
 */
function parseIpv6(ip: string): number[] | null {
  let rest = ip.toLowerCase().split("%")[0]; // Zonen-Index abschneiden

  const embedded = rest.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded?.index !== undefined) {
    if (!net.isIPv4(embedded[1])) return null;
    const [a, b, c, d] = embedded[1].split(".").map(Number);
    rest =
      rest.slice(0, embedded.index) +
      (((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16));
  }

  const halves = rest.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

  let groups: string[];
  if (halves.length === 2) {
    const gap = 8 - head.length - tail.length;
    if (gap < 0) return null;
    groups = [...head, ...Array<string>(gap).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const parsed = groups.map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN
  );
  return parsed.some((n) => !Number.isInteger(n)) ? null : parsed;
}

/** Baut aus zwei 16-Bit-Gruppen die punktierte IPv4-Schreibweise. */
function ipv4FromGroups(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Bewertet eine zerlegte IPv6-Adresse, inkl. Übergangsmechanismen
 * (IPv4-mapped, NAT64, 6to4), die eine interne IPv4-Adresse in sich tragen.
 */
function isPrivateIpv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  if (groups.every((g) => g === 0)) return true; // :: (unspecified)
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return true; // ::1
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  const topZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (topZero && (g5 === 0xffff || g5 === 0)) {
    return isPrivateIp(ipv4FromGroups(g6, g7)); // IPv4-mapped/-compatible
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIp(ipv4FromGroups(g6, g7)); // 64:ff9b::/96 (NAT64)
  }
  if (g0 === 0x2002) return isPrivateIp(ipv4FromGroups(g1, g2)); // 2002::/16 (6to4)

  return false;
}

/**
 * Prüft, ob eine IP-Adresse nicht öffentlich routbar ist.
 * Unbekannte Formate gelten als privat (Ablehnung im Zweifelsfall).
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, inkl. Cloud-Metadaten
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const groups = parseIpv6(ip);
    if (groups === null) return true;
    return isPrivateIpv6(groups);
  }
  return true;
}

/**
 * Prüft, dass eine URL auf ein öffentlich erreichbares http(s)-Ziel zeigt, und
 * gibt sie geparst zurück. Wirft sonst einen client-sicheren Fehlertext.
 *
 * Restrisiko "DNS Rebinding": Zwischen dieser Prüfung und dem eigentlichen
 * fetch löst das Betriebssystem den Hostnamen erneut auf. Vollständiger Schutz
 * würde das Anheften der geprüften IP erfordern, wofür Next.js' fetch keine
 * Schnittstelle bietet.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Ungültige URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Nur http/https-URLs sind erlaubt");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Zugriff auf diesen Host ist nicht erlaubt");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Zugriff auf private/interne Adressen ist nicht erlaubt");
    }
    return url;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Host konnte nicht aufgelöst werden");
  }
  if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
    throw new Error("Zugriff auf private/interne Adressen ist nicht erlaubt");
  }

  return url;
}

/**
 * Ruft eine bereits validierte URL ab und prüft Redirect-Ziele erneut, bevor
 * ihnen gefolgt wird – sonst könnte ein Dienst per 302 auf eine interne
 * Adresse verweisen und die ursprüngliche Prüfung aushebeln.
 */
export async function fetchPublicUrl(
  url: URL,
  options: { headers?: Record<string, string>; signal?: AbortSignal } = {},
  redirectsLeft = MAX_REDIRECTS
): Promise<Response> {
  const response = await fetch(url.toString(), {
    method: "GET",
    redirect: "manual",
    headers: options.headers,
    signal: options.signal,
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location || redirectsLeft <= 0) {
      throw new Error("Ungültiges oder zu häufiges Redirect");
    }
    const nextUrl = await assertPublicUrl(new URL(location, url).toString());
    return fetchPublicUrl(nextUrl, options, redirectsLeft - 1);
  }

  return response;
}
