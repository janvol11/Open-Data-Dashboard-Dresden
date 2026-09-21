// Hilfsfunktionen für serverseitige Abrufe fremder Dienste. Antworten werden
// vollständig in den Speicher gelesen, deshalb braucht jeder Abruf eine
// Obergrenze – sonst könnte ein einzelner Dienst den Serverprozess auslasten.
// Nur serverseitig verwendbar.

/** Liest den Antwortrumpf als Text und bricht ab, sobald `maxBytes` überschritten wird. */
export async function readTextWithLimit(
  response: Response,
  maxBytes: number
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Antwort des Dienstes überschreitet die Größengrenze");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error("Antwort des Dienstes überschreitet die Größengrenze");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

/** Erkennt den Abbruch durch `AbortSignal.timeout()`. */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}
