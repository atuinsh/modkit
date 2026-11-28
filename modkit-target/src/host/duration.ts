const MS_PER_SECOND = 1000

/** Non-negative time duration with explicit unit constructors and accessors. */
export class Duration {
  readonly #ms: number

  private constructor(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`duration must be a non-negative finite number, got ${ms}`)
    }
    this.#ms = ms
  }

  /** Construct a {@link Duration} from whole or fractional milliseconds. */
  static ms(value: number): Duration {
    return new Duration(value)
  }

  /** Construct a {@link Duration} from seconds. */
  static seconds(value: number): Duration {
    return new Duration(value * MS_PER_SECOND)
  }

  /** Duration in milliseconds. */
  get ms(): number {
    return this.#ms
  }

  /** Duration in seconds. */
  get seconds(): number {
    return this.#ms / MS_PER_SECOND
  }
}
