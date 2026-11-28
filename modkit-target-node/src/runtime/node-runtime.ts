import { ModkitTargetRuntime, type Repeat } from '@atuin/modkit-target/host'

import { Timers } from './timers'

/**
 * {@link ModkitTargetRuntime} for Node and Bun harnesses, owning interval timer lifetimes via
 * {@link Disposable}.
 */
export abstract class NodeTargetRuntime<Engine>
  extends ModkitTargetRuntime<Engine>
  implements Disposable
{
  readonly #timers = new Timers()

  protected override repeat(_engine: Engine, { everyMs, tick }: Repeat): void {
    this.#timers.schedule({ everyMs, tick })
  }

  [Symbol.dispose](): void {
    this.#timers[Symbol.dispose]()
  }
}
