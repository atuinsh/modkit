export { ModCompiler } from './compile.ts'
export { DiagnosticError, type DiagnosticCode, type Place } from './diagnostics.ts'
export type {
  Author,
  Compiled,
  HookNeeds,
  ImageDecl,
  ModInfo,
  OptionDecl,
  OptionKind,
  StateDecl,
  StateKind,
} from './ir.ts'
export { ModManifest } from './manifest.ts'
export { MODPARTS, type ModpartName, type ModpartUsage, type Modparts } from './modparts.ts'
export { JsonShape, type Field, type Item, type Shape } from './shape.ts'
