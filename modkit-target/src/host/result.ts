type Outcome<T, E> =
  | { readonly isOk: true; readonly value: T }
  | { readonly isOk: false; readonly error: E }

/** Typed discriminated result for recoverable failures at library and boundary edges. */
export class Result<T, E> {
  readonly #outcome: Outcome<T, E>

  private constructor(outcome: Outcome<T, E>) {
    this.#outcome = outcome
  }

  /** Construct a successful {@link Result}. */
  static ok<T, E = never>(value: T): Result<T, E> {
    return new Result({ isOk: true, value })
  }

  /** Construct a failed {@link Result}. */
  static err<E, T = never>(error: E): Result<T, E> {
    return new Result({ isOk: false, error })
  }

  /** Collect every `ok` value, or fail with all `err` values if any entry failed. */
  static collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E[]> {
    const errors = results.flatMap((one) => (one.#outcome.isOk ? [] : [one.#outcome.error]))
    if (errors.length > 0) return Result.err(errors)
    return Result.ok(results.flatMap((one) => (one.#outcome.isOk ? [one.#outcome.value] : [])))
  }

  /** Narrowable tagged outcome union (`{ isOk: true, value } | { isOk: false, error }`). */
  get outcome(): Outcome<T, E> {
    return this.#outcome
  }

  get isOk(): boolean {
    return this.#outcome.isOk
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return this.#outcome.isOk ? Result.ok(fn(this.#outcome.value)) : Result.err(this.#outcome.error)
  }

  andThen<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return this.#outcome.isOk ? fn(this.#outcome.value) : Result.err(this.#outcome.error)
  }

  unwrapOr(fallback: T): T {
    return this.#outcome.isOk ? this.#outcome.value : fallback
  }
}
