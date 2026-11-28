/** Keyed registry of {@link Disposable} sessions with deterministic teardown. */
export class SessionPool<Entry extends Disposable> implements Disposable {
  readonly #entries = new Map<string, Entry>()

  get(id: string): Entry | undefined {
    return this.#entries.get(id)
  }

  getOrCreate(id: string, create: () => Entry): Entry {
    return this.#entries.getOrInsertComputed(id, create)
  }

  values(): Entry[] {
    return this.#entries.values().toArray()
  }

  [Symbol.dispose](): void {
    for (const entry of this.#entries.values()) entry[Symbol.dispose]()
    this.#entries.clear()
  }
}
