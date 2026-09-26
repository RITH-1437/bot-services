/**
 * Small in-memory TTL set used to avoid duplicate welcomes.
 * Intentionally not persisted: the bot stays stateless, so a restart simply
 * forgets previous welcomes.
 */
export class SeenStore {
  private readonly seen = new Map<string, number>();

  public constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1_000,
  ) {}

  /** Returns true when the key was not seen inside the TTL window. */
  public add(key: string, now = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(key)) {
      return false;
    }
    this.seen.set(key, now);
    this.evictOverflow();
    return true;
  }

  public has(key: string, now = Date.now()): boolean {
    this.prune(now);
    return this.seen.has(key);
  }

  public get size(): number {
    return this.seen.size;
  }

  private prune(now: number): void {
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp >= this.ttlMs) {
        this.seen.delete(key);
      }
    }
  }

  private evictOverflow(): void {
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (oldest.done === true) return;
      this.seen.delete(oldest.value);
    }
  }
}
