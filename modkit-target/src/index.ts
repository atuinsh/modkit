/**
 * The contract every harness target implements, and the mod's package the CLI builds for each.
 *
 * A target's package is `@atuin/modkit-<name>`. It exports a {@link ModkitTarget} from `./codegen`,
 * which runs at build time in Node, and builds its runtime on `@atuin/modkit-target/host` alone.
 *
 * @module
 */

export { NATIVE, type Capabilities, type Support } from './capabilities.ts'
export { gapText, type Checked, type Gap, type ListedTarget } from './listed-target.ts'
export { ModPackage } from './package.ts'
export { ModkitTarget, type BuildInput, type Built, type CompiledMod } from './target.ts'
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
