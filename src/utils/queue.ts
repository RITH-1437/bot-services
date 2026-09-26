/**
 * Serialises async work per key (one chat) so Telegram never receives two
 * messages from us at the same instant, which is a common cause of 429 errors.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  public run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // Run the task whether the previous one resolved or rejected.
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
    return result;
  }

  public get pending(): number {
    return this.tails.size;
  }
}
