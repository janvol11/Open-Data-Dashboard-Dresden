// Zwischenspeicher mit Ablaufzeit und Mengenbegrenzung für serverseitige
// Abrufe. Next.js' Data Cache scheidet für den GovData-Katalog aus, da dessen
// ~6-MB-Antwort dessen 2-MB-Grenze überschreitet; zwischengespeichert wird
// deshalb das bereits gefilterte Ergebnis (wenige KB) statt der Rohantwort.
// Lebt im Arbeitsspeicher des Serverprozesses, überlebt keinen Neustart und
// wird bei mehreren Instanzen nicht geteilt – ausreichend, da er nur Latenz
// spart und jede Anfrage auch ohne ihn korrekt beantwortet wird.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  /** Laufende Ladevorgänge, damit paralleler Bedarf sie sich teilt. */
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  /**
   * Gibt den zwischengespeicherten Wert zurück oder erzeugt ihn über `load`.
   * Parallele Anfragen für denselben Schlüssel teilen sich denselben
   * Ladevorgang, statt ihn mehrfach auszulösen. Fehlgeschlagene Ladevorgänge
   * werden nicht gespeichert; der nächste Aufruf versucht es erneut.
   */
  async resolve(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      // Neu einfügen, damit Verdrängung den am längsten ungenutzten Eintrag trifft
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }
    if (cached) this.entries.delete(key);

    const running = this.inFlight.get(key);
    if (running) return running;

    const pending = load()
      .then((value) => {
        this.store(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, pending);
    return pending;
  }

  /** Anzahl gültiger Einträge – für Diagnose und Tests. */
  get size(): number {
    return this.entries.size;
  }

  private store(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
