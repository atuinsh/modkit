/** Keyed registry of {@link Disposable} sessions with deterministic teardown. */
export class SessionPool<Entry extends Disposable> implements Disposable {
  readonly #entries = new Map<string, Entry>()

  get(id: string): Entry | undefined {
    return this.#entries.get(id)
  }

  getOrCreate(id: string, create: () => Entry): Entry {
    const existing = this.#entries.get(id)
    if (existing !== undefined) return existing
    const created = create()
    this.#entries.set(id, created)
    return created
  }

  values(): Entry[] {
    return [...this.#entries.values()]
  }

  [Symbol.dispose](): void {
    for (const entry of this.#entries.values()) entry[Symbol.dispose]()
    this.#entries.clear()
  }
}
