/** Return whether `value` is a plain JSON-like object record. */
export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Extract a human-readable message from an unknown thrown value. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Return `value` when it is a plain object, or an empty record otherwise. */
export const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  isPlainRecord(value) ? value : {}
