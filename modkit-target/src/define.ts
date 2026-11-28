import * as v from 'valibot'

import type { Capabilities } from './capabilities.ts'
import {
  DefinedTarget,
  type KnownTools,
  type TargetBuildContext,
  type TargetBuilt,
} from './defined-target.ts'
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
  readonly #tools: KnownTools | undefined

  constructor({
    name,
    capabilities,
    options,
    tools,
  }: {
    name: string
    capabilities: Capabilities
    options: v.GenericSchema<unknown, Options>
    tools: KnownTools | undefined
  }) {
    this.#name = name
    this.#capabilities = capabilities
    this.#options = options
    this.#tools = tools
  }

  /** Declare the Valibot schema for target-specific `package.json` options. */
  options<Next>(schema: v.GenericSchema<unknown, Next>): TargetBuilder<Next> {
    return new TargetBuilder({
      name: this.#name,
      capabilities: this.#capabilities,
      options: schema,
      tools: this.#tools,
    })
  }

  /** Declare built-in tools this harness provides so missing-tool notes are emitted automatically. */
  knownTools(harness: string, has: ReadonlySet<string>): TargetBuilder<Options> {
    return new TargetBuilder({
      name: this.#name,
      capabilities: this.#capabilities,
      options: this.#options,
      tools: { harness, has },
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
      new TargetBuilder({ name, capabilities, options: NO_OPTIONS, tools: undefined }),
  }),
}
