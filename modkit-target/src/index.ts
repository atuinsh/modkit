/**
 * The contract every harness target implements, and the mod's package the CLI builds for each.
 *
 * A target's package is `@atuin/modkit-<name>`. It exports a {@link ModkitTarget} from `./codegen`,
 * which runs at build time in Node, and builds its runtime on `@atuin/modkit-target/host`'s
 * `ModkitTargetRuntime` alone.
 *
 * @module
 */

export {
  NATIVE,
  type Capabilities,
  type DroppedSupport,
  type LoweredSupport,
  type NativeSupport,
  type Support,
} from './host/capabilities.ts'
export {
  Target,
  TargetBuilder,
  type ArtifactWriter,
  type NamedTargetBuilder,
  type TargetBuildContext,
  type TargetBuilt,
} from './define.ts'
export { Result } from './host/result.ts'
export { HarnessTools } from './host/tools.ts'
export { errorMessage } from './host/values.ts'
export { imagesSource } from './images.ts'
export { gapText, type Checked, type Gap, type ListedTarget } from './listed-target.ts'
export { ModPackage } from './package.ts'
export { PluginName } from './plugin-name.ts'
export { TargetRef } from './target-ref.ts'
export { ModkitTarget, type BuildInput, type Built, type CompiledMod } from './target.ts'
export {
  pluginNameOf,
  type Author,
  type Diagnostic,
  type Field,
  type HookNeeds,
  type ImageDecl,
  type Item,
  type ModInfo,
  type ModpartName,
  type OptionDecl,
  type OptionKind,
  type Shape,
  type StateDecl,
  type StateKind,
} from '@atuin/modkit-compiler'
