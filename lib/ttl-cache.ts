// Einfacher In-Memory-Cache mit Ablaufzeit und Höchstzahl an Einträgen.
// Überlebt keinen Neustart, reicht aber, weil er nur Wartezeit spart.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  /** Laufende Ladevorgänge, damit parallele Anfragen nur einmal laden */
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  /** Fehlgeschlagene Ladevorgänge werden nicht gespeichert. */
  async resolve(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      // Ans Ende verschieben (LRU)
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

  private store(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
