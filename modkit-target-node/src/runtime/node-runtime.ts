import { ModkitTargetRuntime, type Capabilities, type Repeat } from '@atuin/modkit-target/host'

import { Timers } from './timers.ts'

/**
 * {@link ModkitTargetRuntime} for Node and Bun harnesses, owning interval timer lifetimes and
 * disposal state via {@link Disposable}.
 */
export abstract class NodeTargetRuntime<Engine, Caps extends Capabilities = Capabilities>
  extends ModkitTargetRuntime<Engine, Caps>
  implements Disposable
{
  readonly #timers = new Timers()

  protected override repeat(_engine: Engine, { everyMs, tick }: Repeat): void {
    this.#timers.schedule({ everyMs, tick })
  }

  [Symbol.dispose](): void {
    this.disposeSession()
    this.#timers[Symbol.dispose]()
  }
}
