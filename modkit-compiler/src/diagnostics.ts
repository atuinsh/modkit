/**
 * Structured compiler diagnostics and formatting utilities.
 *
 * @module
 */

import type { Diagnostic as TsDiagnostic, Node, SourceFile } from './program.ts'

/** Stable machine-readable diagnostic identifier emitted by the compiler. */
export type DiagnosticCode =
  /** TypeScript syntax or type error in a mod source file. */
  | 'type-error'
  /** `package.json` is missing, invalid JSON, or missing `name`, `version`, or `description`. */
  | 'manifest'
  /** `tsconfig.json` is missing or TypeScript failed to load the project configuration. */
  | 'project'
  | 'no-mod'
  | 'mod-parts'
  | 'state-id'
  | 'state-not-json'
  | 'duplicate-state'
  | 'option-type'
  /** Setting default is not a static literal (or `const` holding one) matching its kind. */
  | 'option-default'
  | 'option-no-description'
  /** A `harness.env()` call passes a non-literal variable name. */
  | 'env-name'
  | 'tool-name'
  /** An `<Img>` names its PNG with no string literal, or names no PNG in the mod's directory. */
  | 'image'
  /** A mod imports what only a target may: `@atuin/modkit/host` or an `@atuin/modkit-*` package. */
  | 'host-import'
  /** `package.json` lists no `modkit.targets`, or its `modkit` field is malformed. */
  | 'targets'
  /** A target `modkit.targets` lists is not installed, or its package exports no target. */
  | 'target-missing'
  /** A target's section of the `modkit` field fails that target's options. */
  | 'target-options'
  /** A target lowers or drops a modpart the mod uses, and the mod's `gaps` do not accept it. */
  | 'target-gap'
  /** The mod accepts a gap that its target or its own parts do not have. */
  | 'stale-gap'

/** A 1-based location in a source file. */
export interface Place {
  file: string
  /** 1-based line number. */
  line: number
  /** 1-based column number. */
  column: number
}

/** A compiler error anchored to a 1-based source location. */
export interface Diagnostic extends Place {
  code: DiagnosticCode
  message: string
}

function placeOf({ file, position }: { file: SourceFile; position: number }): Place {
  const { line, character } = file.getLineAndCharacterOfPosition(position)
  return { file: file.fileName, line: line + 1, column: character + 1 }
}

/** The {@link Place} where AST `node` starts. */
export function placeAt(node: Node): Place {
  const file = node.getSourceFile()
  return placeOf({ file, position: node.getStart(file) })
}

/** Build a {@link Diagnostic} anchored at the start of AST `node`. */
export function diagnosticAt({
  code,
  message,
  node,
}: {
  code: DiagnosticCode
  message: string
  node: Node
}): Diagnostic {
  return { code, message, ...placeAt(node) }
}

/** Convert a TypeScript diagnostic in `file` into a modkit `'type-error'` {@link Diagnostic}. */
export const fromTypeScript = ({
  error,
  file,
}: {
  error: TsDiagnostic
  file: SourceFile
}): Diagnostic => ({
  code: 'type-error',
  message: error.text,
  ...placeOf({ file, position: error.pos }),
})

/** Format a {@link Diagnostic} as `<file>:<line>:<column>: <code>: <message>`. */
export const formatDiagnostic = ({ file, line, column, code, message }: Diagnostic): string =>
  `${file}:${line}:${column}: ${code}: ${message}`
