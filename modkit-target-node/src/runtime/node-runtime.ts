import { ModkitTargetRuntime, type Capabilities, type Repeat } from '@atuin/modkit-target/host'

import { Timers } from './timers.ts'

/**
 * {@link ModkitTargetRuntime} for Node and Bun harnesses, owning interval timers and registered
 * {@link Disposable} resources (torn down in LIFO order via {@link Symbol.dispose}).
 */
export abstract class NodeTargetRuntime<Engine, Caps extends Capabilities = Capabilities>
  extends ModkitTargetRuntime<Engine, Caps>
  implements Disposable
{
  readonly #timers = new Timers()
  readonly #owned: Disposable[] = []

  /** Register a {@link Disposable} resource to be torn down in LIFO order when this runtime disposes. */
  protected own<T extends Disposable>(resource: T): T {
    if (this.isDisposed) {
      resource[Symbol.dispose]()
      return resource
    }
    this.#owned.push(resource)
    return resource
  }

  protected override repeat(_engine: Engine, { everyMs, tick }: Repeat): void {
    this.#timers.schedule({ everyMs, tick })
  }

  [Symbol.dispose](): void {
    const errors: unknown[] = []
    const attempt = (fn: () => void): void => {
      try {
        fn()
      } catch (error) {
        errors.push(error)
      }
    }
    attempt(() => {
      this.disposeSession()
    })
    attempt(() => {
      this.#timers[Symbol.dispose]()
    })
    for (const resource of this.#owned.splice(0).toReversed()) {
      attempt(() => {
        resource[Symbol.dispose]()
      })
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'multiple resources failed to dispose')
  }
}
