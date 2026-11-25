export { compile } from './compile.ts'
export { authorOf } from './manifest.ts'
export { MODPARTS, type ModpartCounts, type ModpartName } from './modparts.ts'
export { formatDiagnostic, type Diagnostic, type DiagnosticCode } from './diagnostics.ts'
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
