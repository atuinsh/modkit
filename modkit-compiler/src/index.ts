export { compile } from './compile.ts'
export { authorOf, manifestAt } from './manifest.ts'
export { MODPARTS, type ModpartName, type ModpartUsage, type Modparts } from './modparts.ts'
export {
  formatDiagnostic,
  type Diagnostic,
  type DiagnosticCode,
  type Place,
} from './diagnostics.ts'
export type {
  Author,
  Compiled,
  ModInfo,
  OptionDecl,
  OptionKind,
  StateDecl,
  StateKind,
} from './ir.ts'
export { pluginNameOf } from './names.ts'
export { canonical, tagOf, type Field, type Item, type Shape } from './shape.ts'
