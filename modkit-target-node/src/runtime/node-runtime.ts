import { ModkitTargetRuntime, type Capabilities, type Repeat } from '@atuin/modkit-target/host'

import { Timers } from './timers.ts'

/**
 * {@link ModkitTargetRuntime} for Node and Bun harnesses, owning interval timers and registered
 * {@link Disposable} resources via a native {@link DisposableStack}.
 */
export abstract class NodeTargetRuntime<
  Engine,
  Caps extends Capabilities = Capabilities,
> extends ModkitTargetRuntime<Engine, Caps> {
  readonly #timers = new Timers()
  readonly #stack = new DisposableStack()

  constructor(init: ConstructorParameters<typeof ModkitTargetRuntime<Engine, Caps>>[0]) {
    super(init)
    this.#stack.use(this.#timers)
  }

  /** Register a {@link Disposable} resource to be torn down in LIFO order when this runtime disposes. */
  protected own<T extends Disposable>(resource: T): T {
    if (this.#stack.disposed) {
      resource[Symbol.dispose]()
      return resource
    }
    return this.#stack.use(resource)
  }

  protected override repeat(_engine: Engine, { everyMs, tick }: Repeat): void {
    this.#timers.schedule({ everyMs, tick })
  }

  override [Symbol.dispose](): void {
    try {
      super[Symbol.dispose]()
    } finally {
      this.#stack.dispose()
    }
  }
}
