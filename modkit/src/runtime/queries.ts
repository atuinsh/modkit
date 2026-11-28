import * as v from 'valibot'

import type { HarnessAdapter } from '../harness/types.ts'
import { recordOf, type HarnessEvent, type QueryRecord } from '../ui/hooks/query.ts'
import type { QueryRegistration, RenderScope } from './frame.ts'

interface Fetching {
  again: boolean
  done: Promise<void>
}

// Read through a call: TypeScript would keep `again` narrowed to the `false` it was set to across
// the `await`, though `refresh` sets it meanwhile.
const isAskedAgain = (fetching: Fetching): boolean => fetching.again

type Asked = QueryRegistration & { key: string }

const isAsked = (registration: QueryRegistration): registration is Asked =>
  registration.key !== undefined

function isDue({
  record,
  asked,
  now,
}: {
  record: QueryRecord | undefined
  asked: Asked
  now: number
}): boolean {
  if (record === undefined || record.input !== asked.key) return true
  const { everyMs } = asked.query
  return everyMs !== undefined && now - record.at >= everyMs
}

export class Queries implements Disposable {
  readonly #adapter: HarnessAdapter
  readonly #write: RenderScope['write']
  #registered = new Map<string, QueryRegistration>()
  #isMounted = false
  #isDisposed = false
  readonly #fetching = new Map<string, Fetching>()

  constructor({ adapter, write }: { adapter: HarnessAdapter; write: RenderScope['write'] }) {
    this.#adapter = adapter
    this.#write = write
  }

  /** Stop scheduling or retrying queries once the mounted session has been torn down. */
  [Symbol.dispose](): void {
    this.#isDisposed = true
    this.#registered.clear()
  }

  register(registrations: readonly QueryRegistration[]): void {
    if (this.#isDisposed) return
    const registered = new Map<string, QueryRegistration>()
    for (const one of registrations) {
      const earlier = registered.get(one.query.id)
      if (earlier !== undefined && earlier.key !== one.key) {
        throw new Error(`${one.query.id} is asked for with two inputs in one render; it holds one`)
      }
      registered.set(one.query.id, one)
    }
    this.#registered = registered
    // The mount's own queries wait for the harness's first event, which the target sends right after.
    if (!this.#isMounted) {
      this.#isMounted = true
      return
    }
    // After the render that asked, which a fetch must not run inside.
    for (const id of this.#due()) void Promise.resolve().then(async () => this.refresh(id))
  }

  async refreshDue(event?: HarnessEvent): Promise<void> {
    if (this.#isDisposed) return
    const listening = [...this.#registered.values()].flatMap((one) =>
      event !== undefined && isAsked(one) && one.query.on?.includes(event) === true
        ? [one.query.id]
        : [],
    )
    await Promise.all(
      [...new Set([...this.#due(), ...listening])].map(async (id) => this.refresh(id)),
    )
  }

  async refresh(id: string): Promise<void> {
    if (this.#isDisposed) return
    const under = this.#fetching.get(id)
    if (under !== undefined) {
      under.again = true
      return under.done
    }
    const fetching: Fetching = { again: false, done: Promise.resolve() }
    this.#fetching.set(id, fetching)
    fetching.done = this.#fetchWhileAsked({ id, fetching })
    return fetching.done
  }

  async settle(): Promise<void> {
    while (this.#fetching.size > 0) {
      // oxlint-disable-next-line no-await-in-loop -- each round waits for fetches the last one started
      await Promise.all([...this.#fetching.values()].map(async (one) => one.done))
    }
  }

  #due(): string[] {
    const now = this.#adapter.now()
    return [...this.#registered.values()].flatMap((one) =>
      isAsked(one) &&
      !this.#fetching.has(one.query.id) &&
      isDue({ record: recordOf(this.#adapter.store.get(one.query.id)), asked: one, now })
        ? [one.query.id]
        : [],
    )
  }

  async #fetchWhileAsked({ id, fetching }: { id: string; fetching: Fetching }): Promise<void> {
    try {
      do {
        // oxlint-disable-next-line eslint/no-param-reassign -- refresh asks for one more round through this same record
        fetching.again = false
        // oxlint-disable-next-line no-await-in-loop -- the next fetch is the one asked for during this
        await this.#fetchOnce(id)
      } while (!this.#isStopped() && (isAskedAgain(fetching) || this.#isStale(id)))
    } finally {
      this.#fetching.delete(id)
    }
  }

  // Read through a method so TypeScript does not keep `#isDisposed` narrowed to `false` across `await`.
  #isStopped(): boolean {
    return this.#isDisposed
  }

  // A render that changed the input while its fetch ran wants the new input's value.
  #isStale(id: string): boolean {
    if (this.#isDisposed) return false
    const asked = this.#registered.get(id)
    if (asked === undefined || !isAsked(asked)) return false
    return recordOf(this.#adapter.store.get(id))?.input !== asked.key
  }

  async #fetchOnce(id: string): Promise<void> {
    if (this.#isDisposed) return
    const asked = this.#registered.get(id)
    if (asked === undefined || !isAsked(asked)) return
    const { key } = asked
    const kept = recordOf(this.#adapter.store.get(id))
    const fetched = await this.#fetched(asked)
    if (this.#isStopped() || this.#registered.get(id)?.key !== key) return
    this.#commit({ id, key, kept, fetched })
  }

  #commit({
    id,
    key,
    kept,
    fetched,
  }: {
    id: string
    key: string
    kept: QueryRecord | undefined
    fetched: { isOk: true; value: unknown } | { isOk: false; error: unknown }
  }): void {
    const at = this.#adapter.now()
    if (fetched.isOk) {
      this.#write({ key: id, stored: { value: { input: key, at, value: fetched.value } } })
      return
    }
    this.#adapter.report({ phase: 'query', error: fetched.error })
    const value = kept?.input === key ? kept.value : undefined
    this.#write({
      key: id,
      stored: { value: { input: key, at, ...(value !== undefined && { value }) } },
    })
  }

  async #fetched({
    query,
    input,
  }: Asked): Promise<{ isOk: true; value: unknown } | { isOk: false; error: unknown }> {
    try {
      return { isOk: true, value: v.parse(query.schema, await query.fetch(this.#adapter, input)) }
    } catch (error) {
      return { isOk: false, error }
    }
  }
}
