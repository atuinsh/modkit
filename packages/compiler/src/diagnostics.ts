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

/** A compiler error anchored to a 1-based source location. */
export interface Diagnostic {
  code: DiagnosticCode
  message: string
  file: string
  /** 1-based line number. */
  line: number
  /** 1-based column number. */
  column: number
}

function placeOf({
  file,
  position,
}: {
  file: SourceFile
  position: number
}): Pick<Diagnostic, 'file' | 'line' | 'column'> {
  const { line, character } = file.getLineAndCharacterOfPosition(position)
  return { file: file.fileName, line: line + 1, column: character + 1 }
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
  const file = node.getSourceFile()
  return { code, message, ...placeOf({ file, position: node.getStart(file) }) }
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
