import type * as v from 'valibot'

import type { Compiled, Diagnostic } from '@atuin/modkit-compiler'

import type { Capabilities } from './capabilities.ts'

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
  | { isOk: false; diagnostics: readonly Diagnostic[] }

/**
 * A harness target: the name a mod picks it by, the modparts it provides, and how it builds a mod.
 *
 * A target's package is `@atuin/modkit-<name>` and exports its `target` from `./codegen`.
 */
export interface Target<Options = unknown> {
  /** The name a mod lists in its `modkit.targets`, `claude-code`. */
  readonly name: string
  readonly capabilities: Capabilities
  /** Checks the target's section of the mod's `modkit` field, less its `gaps`. */
  readonly options: v.GenericSchema<unknown, Options>
  readonly build: (input: BuildInput<Options>) => Promise<Built>
}
