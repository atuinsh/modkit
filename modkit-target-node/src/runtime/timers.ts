import { setInterval as every } from 'node:timers/promises'

/** Interval scheduler driven by an {@link AbortSignal}, stopping automatically when aborted. */
export class Timers implements Disposable {
  readonly #abort: AbortController
  readonly #signal: AbortSignal

  constructor(signal?: AbortSignal) {
    this.#abort = new AbortController()
    this.#signal =
      signal === undefined ? this.#abort.signal : AbortSignal.any([signal, this.#abort.signal])
  }

  /** Schedule `tick` every `everyMs`, unreferenced by default so timers do not pin Node exit. */
  schedule({
    everyMs,
    tick,
    unref = true,
  }: {
    everyMs: number
    tick: () => void
    unref?: boolean
  }): void {
    if (this.#signal.aborted) return
    void this.#loop({ everyMs, tick, ref: !unref })
  }

  [Symbol.dispose](): void {
    this.#abort.abort()
  }

  async #loop({
    everyMs,
    tick,
    ref,
  }: {
    everyMs: number
    tick: () => void
    ref: boolean
  }): Promise<void> {
    try {
      for await (const runTick of every(everyMs, tick, { signal: this.#signal, ref })) {
        runTick()
      }
    } catch {
      // Aborted when the runtime disposes.
    }
  }
}
