import * as v from 'valibot'

import { activeFrame } from '../../runtime/frame.ts'
import { checked, type Json } from '../../runtime/schema.ts'

export interface State<T> {
  readonly id: string
  readonly schema: v.GenericSchema<unknown, T>
  readonly initial: T
}

export function state<S extends v.GenericSchema<unknown, Json>>(declaration: {
  id: string
  schema: S
  initial: NoInfer<v.InferOutput<S>>
}): State<v.InferOutput<S>> {
  return declaration
}

/** Update a state value directly or derive the next value from the current one. */
export type SetState<T> = (next: T | ((current: T) => T)) => void

const isUpdate = <T>(next: T | ((current: T) => T)): next is (current: T) => T =>
  typeof next === 'function'

export function useState<T>({ id, schema, initial }: State<T>): [T, SetState<T>] {
  const { scope } = activeFrame('useState')
  const read = (): T => {
    const stored = scope.store.get(id)
    if (stored === undefined) return initial
    const parsed = v.safeParse(schema, stored.value)
    return parsed.success ? parsed.output : initial
  }
  const set: SetState<T> = (next) => {
    const value = checked({ holder: id, schema, value: isUpdate(next) ? next(read()) : next })
    scope.write({ key: id, stored: { value } })
  }
  return [read(), set]
}
