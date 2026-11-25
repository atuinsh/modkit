import { isPlainObject } from 'es-toolkit/predicate'
import * as v from 'valibot'

export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json }

const LeafSchema = v.union([v.null(), v.string(), v.boolean(), v.pipe(v.number(), v.finite())])

const isContainer = (value: unknown): boolean => Array.isArray(value) || isPlainObject(value)

// A value that is no list or plain object parses as a leaf and fails its check, not its type: a
// union names the path only of a member that got as far as a check.
export const JsonSchema: v.GenericSchema<unknown, Json> = v.lazy(() =>
  v.union([
    v.array(JsonSchema),
    v.pipe(
      v.custom<Readonly<Record<string, unknown>>>(isPlainObject),
      v.record(v.string(), JsonSchema),
    ),
    v.pipe(
      v.custom<Json>((value) => !isContainer(value)),
      v.check(
        (value) => v.is(LeafSchema, value),
        (issue) => `can't hold ${issue.received}: a mod's state is JSON`,
      ),
    ),
  ]),
)

/** Type-erased callback invoked by the runtime with modpart-specific inputs. */
export type Callback = (input?: unknown) => unknown

/** Schema validating an untyped runtime callback prop. */
export const CallbackSchema: v.GenericSchema<Callback> = v.custom<Callback>(
  (value) => typeof value === 'function',
  'expected a function',
)

/** Format `value` concisely for error messages (e.g. `{"ask":1}`, `undefined`, `function`). */
export const describe = (value: unknown): string =>
  value === undefined || typeof value === 'function' || typeof value === 'symbol'
    ? typeof value
    : JSON.stringify(value)

export function checked<T>({
  holder,
  schema,
  value,
}: {
  holder: string
  schema: v.GenericSchema<unknown, T>
  value: unknown
}): T {
  const read = v.safeParse(schema, value)
  if (read.success) return read.output
  const [issue] = read.issues
  const path = v.getDotPath(issue)
  throw new TypeError(`${holder}${path === null ? '' : `.${path}`}: ${issue.message}`)
}
