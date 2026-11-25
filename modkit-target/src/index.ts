/**
 * The contract every harness target implements, and the checks the CLI runs across targets.
 *
 * A target's package is `@atuin/modkit-<name>`. It exports a {@link Target} from `./codegen`, which
 * runs at build time in Node, and builds its runtime on `@atuin/modkit-target/host` alone.
 *
 * @module
 */

export { NATIVE, type Capabilities, type Support } from './capabilities.ts'
export { gapText, gapsIn, type Gap } from './gaps.ts'
export { targetsIn, type Selected } from './load.ts'
export type { BuildInput, Built, CompiledMod, Target } from './target.ts'
export {
  pluginNameOf,
  type Author,
  type Diagnostic,
  type Field,
  type Item,
  type ModInfo,
  type ModpartName,
  type OptionDecl,
  type OptionKind,
  type Shape,
  type StateDecl,
  type StateKind,
} from '@atuin/modkit-compiler'
