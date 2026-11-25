import canonicalize from 'canonicalize'
import * as v from 'valibot'

import type { Harness, Stored } from '../../harness/types'
import { activeFrame } from '../../runtime/frame'
import { checked, type Json } from '../../runtime/schema'

type Awaitable<T> = T | Promise<T>

const HARNESS_EVENTS = ['session.start', 'turn.end', 'shell.after'] as const

export type HarnessEvent = (typeof HARNESS_EVENTS)[number]

export interface Query<I, T> {
  readonly id: string
  readonly schema: v.GenericSchema<unknown, T>
  readonly initial: T
  readonly fetch: (harness: Harness, input: I) => Awaitable<T>
  readonly everyMs?: number
  readonly on?: readonly HarnessEvent[]
}

const ScheduleSchema = v.object({
  everyMs: v.optional(
    v.pipe(
      v.number("a query's everyMs is a whole number of milliseconds above 0"),
      v.integer("a query's everyMs is a whole number of milliseconds above 0"),
      v.minValue(1, "a query's everyMs is a whole number of milliseconds above 0"),
    ),
  ),
  on: v.optional(
    v.array(v.picklist(HARNESS_EVENTS, `a query's events are among: ${HARNESS_EVENTS.join(', ')}`)),
  ),
})

export function query<
  S extends v.GenericSchema<unknown, Json>,
  I extends NonNullable<Json> | undefined = undefined,
>(declaration: {
  id: string
  schema: S
  initial: NoInfer<v.InferOutput<S>>
  fetch: (harness: Harness, input: I) => Awaitable<NoInfer<v.InferOutput<S>>>
  everyMs?: number
  on?: readonly HarnessEvent[]
}): Query<I, v.InferOutput<S>> {
  const parsed = v.safeParse(ScheduleSchema, declaration)
  if (!parsed.success) throw new TypeError(`${declaration.id}: ${parsed.issues[0].message}`)
  return declaration
}

export interface QueryRecord {
  input: string
  at: number
  value?: unknown
}

const RecordSchema = v.object({
  input: v.string(),
  at: v.number(),
  value: v.optional(v.unknown()),
})

export function recordOf(stored: Stored | undefined): QueryRecord | undefined {
  const parsed = v.safeParse(RecordSchema, stored?.value)
  if (!parsed.success) return undefined
  const { input, at, value } = parsed.output
  return value === undefined ? { input, at } : { input, at, value }
}

const inputKey = (input: unknown): string => canonicalize(input ?? null) ?? 'null'

export interface Fetched<T> {
  readonly value: T
  refresh(): Promise<void>
  set(value: T): void
}

export function useQuery<T>(query: Query<undefined, T>): Fetched<T>
export function useQuery<I, T>(query: Query<I, T>, input: I | null): Fetched<T>
export function useQuery<I, T>(declared: Query<I, T>, input?: I | null): Fetched<T> {
  const { scope } = activeFrame('useQuery')
  const { id, schema, initial } = declared
  const key = input === null ? undefined : inputKey(input)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the scheduler hands `fetch` back the input it was registered with
  scope.query({ query: declared as Query<unknown, unknown>, key, input })
  const record = recordOf(scope.store.get(id))
  const held =
    record !== undefined && record.input === key ? v.safeParse(schema, record.value) : undefined
  return {
    value: held?.success === true ? held.output : initial,
    refresh: () => scope.refresh(id),
    set: (value) => {
      if (key === undefined) throw new Error(`${id} has no input to hold a value for`)
      const kept = checked({ holder: id, schema, value })
      scope.write({
        key: id,
        stored: { value: { input: key, at: scope.harness.now(), value: kept } },
      })
    },
  }
}
