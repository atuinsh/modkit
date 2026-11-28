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
export { Gap } from './gap.ts'
export { ImageBundle } from './images.ts'
export { ListedTarget, type Checked } from './listed-target.ts'
export { ModPackage } from './package.ts'
export { PluginName } from './plugin-name.ts'
export { TargetRef } from './target-ref.ts'
export { ModkitTarget, type BuildInput, type Built, type CompiledMod } from './target.ts'
export type {
  Author,
  Diagnostic,
  Field,
  HookNeeds,
  ImageDecl,
  Item,
  ModInfo,
  ModpartName,
  OptionDecl,
  OptionKind,
  Shape,
  StateDecl,
  StateKind,
} from '@atuin/modkit-compiler'
