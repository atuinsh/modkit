import type { DevCommand, DevHarness, DevSession, DevSpec, Reload } from './dev.ts'

/** A target's {@link DevSpec} as the whole {@link DevHarness}, doing nothing for what it leaves out. */
export class DefinedHarness implements DevHarness {
  readonly #spec: DevSpec

  constructor(spec: DevSpec) {
    this.#spec = spec
  }

  get reload(): Reload {
    return this.#spec.reload
  }

  get writes(): readonly string[] {
    return this.#spec.writes ?? []
  }

  readonly command = (session: DevSession): DevCommand => this.#spec.command(session)

  readonly built = async (): Promise<void> => {
    await this.#spec.built?.()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#spec[Symbol.asyncDispose]?.()
  }
}
