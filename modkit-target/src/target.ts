import type * as v from 'valibot'

import type { Compiled, DiagnosticError } from '@atuin/modkit-compiler'

import type { Capabilities } from './host/capabilities.ts'

/** A mod the compiler read without error. */
export type CompiledMod = Extract<Compiled, { isOk: true }>

/** What a target's build is handed. */
export interface BuildInput<Options> {
  compiled: CompiledMod
  /** The mod's package directory. */
  dir: string
  /** The directory the target writes its package into, `<out>/<target name>`. */
  out: string
  options: Options
}

/** The package a target's build wrote, or why it wrote none. */
export type Built =
  | {
      isOk: true
      /** The harness's name for the package, `atuin-mod`. */
      plugin: string
      /** Lines printed under the build, such as how to load the package. */
      notes: readonly string[]
    }
  | { isOk: false; diagnostics: readonly DiagnosticError[] }

/**
 * A harness target: the name a mod picks it by, the modparts it provides, and how it builds a mod.
 *
 * A target's package is `@atuin/modkit-<name>`, and exports an instance of its subclass as `target`
 * from `./codegen`. The CLI loads only an instance of this class, so a target extends it rather
 * than matching its shape.
 */
export abstract class ModkitTarget<Options = unknown> {
  /** The name a mod lists in its `modkit.targets`, `claude-code`. */
  abstract readonly name: string
  /** How the target provides each modpart. */
  abstract readonly capabilities: Capabilities
  /** Checks the target's section of the mod's `modkit` field, less its `gaps`. */
  abstract readonly options: v.GenericSchema<unknown, Options>

  /** Write the mod's package for the harness into `input.out`. */
  abstract build(input: BuildInput<Options>): Promise<Built>
}
