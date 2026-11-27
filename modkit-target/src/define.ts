import * as v from 'valibot'

import {
  DefinedTarget,
  type DevOf,
  type TargetBuildContext,
  type TargetBuilt,
} from './defined-target.ts'
import type { Capabilities } from './host/capabilities.ts'
import type { HarnessTools } from './host/tools.ts'
import type { ModkitTarget } from './target.ts'

export type { ArtifactWriter, TargetBuildContext, TargetBuilt } from './defined-target.ts'

const NO_OPTIONS: v.GenericSchema<unknown, undefined> = v.pipe(
  v.strictObject({}),
  v.transform(() => undefined),
)

/** Configured builder ready for optional settings/tool declarations and terminal {@link build}. */
export class TargetBuilder<Options> {
  readonly #name: string
  readonly #capabilities: Capabilities
  readonly #options: v.GenericSchema<unknown, Options>
  readonly #tools: HarnessTools | undefined
  readonly #dev: DevOf | undefined

  constructor({
    name,
    capabilities,
    options,
    tools,
    dev,
  }: {
    name: string
    capabilities: Capabilities
    options: v.GenericSchema<unknown, Options>
    tools: HarnessTools | undefined
    dev: DevOf | undefined
  }) {
    this.#name = name
    this.#capabilities = capabilities
    this.#options = options
    this.#tools = tools
    this.#dev = dev
  }

  /** Declare the Valibot schema for target-specific `package.json` options. */
  options<Next>(schema: v.GenericSchema<unknown, Next>): TargetBuilder<Next> {
    return new TargetBuilder({
      name: this.#name,
      capabilities: this.#capabilities,
      options: schema,
      tools: this.#tools,
      dev: this.#dev,
    })
  }

  /** Declare built-in tools this harness provides so missing-tool notes are emitted automatically. */
  knownTools(tools: HarnessTools): TargetBuilder<Options> {
    return new TargetBuilder({
      name: this.#name,
      capabilities: this.#capabilities,
      options: this.#options,
      tools,
      dev: this.#dev,
    })
  }

  /** Declare how `modkit dev` runs the harness on the target's build. */
  dev(fn: DevOf): TargetBuilder<Options> {
    return new TargetBuilder({
      name: this.#name,
      capabilities: this.#capabilities,
      options: this.#options,
      tools: this.#tools,
      dev: fn,
    })
  }

  /** Finalize the target with its declarative build callback. */
  build(
    fn: (ctx: TargetBuildContext<Options>) => Promise<TargetBuilt> | TargetBuilt,
  ): ModkitTarget<Options> {
    return new DefinedTarget({
      name: this.#name,
      capabilities: this.#capabilities,
      options: this.#options,
      tools: this.#tools,
      build: fn,
      dev: this.#dev,
    })
  }
}

/** First typestate step of {@link Target.define}: capabilities must be declared before building. */
export interface NamedTargetBuilder {
  /** Declare how this harness supports each of the 8 modparts. */
  readonly capabilities: (capabilities: Capabilities) => TargetBuilder<undefined>
}

/** Entry point for defining a {@link ModkitTarget} declaratively. */
export const Target: { readonly define: (name: string) => NamedTargetBuilder } = {
  define: (name) => ({
    capabilities: (capabilities) =>
      new TargetBuilder({
        name,
        capabilities,
        options: NO_OPTIONS,
        tools: undefined,
        dev: undefined,
      }),
  }),
}
