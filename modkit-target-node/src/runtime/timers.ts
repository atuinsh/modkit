/** Collection of interval timers torn down together via {@link Symbol.dispose}. */
export class Timers implements Disposable {
  readonly #handles: NodeJS.Timeout[] = []

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
    const handle = setInterval(tick, everyMs)
    if (unref) handle.unref()
    this.#handles.push(handle)
  }

  [Symbol.dispose](): void {
    for (const handle of this.#handles.splice(0)) clearInterval(handle)
  }
}
