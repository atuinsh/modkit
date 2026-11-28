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
  readonly file: string
  /** 1-based line number. */
  readonly line: number
  /** 1-based column number. */
  readonly column: number
}

function placeOf({ file, position }: { file: SourceFile; position: number }): Place {
  const { line, character } = file.getLineAndCharacterOfPosition(position)
  return { file: file.fileName, line: line + 1, column: character + 1 }
}

/** A compiler error anchored to a 1-based source location; thrown on single-item failures. */
export class DiagnosticError extends Error implements Place {
  override readonly name = 'DiagnosticError'
  readonly code: DiagnosticCode
  readonly file: string
  readonly line: number
  readonly column: number

  constructor({
    code,
    message,
    file,
    line,
    column,
    cause,
  }: {
    code: DiagnosticCode
    message: string
    file: string
    line: number
    column: number
    cause?: unknown
  }) {
    super(message, cause === undefined ? undefined : { cause })
    this.code = code
    this.file = file
    this.line = line
    this.column = column
  }

  /** The 1-based {@link Place} where AST `node` starts. */
  static placeAt(node: Node): Place {
    const file = node.getSourceFile()
    return placeOf({ file, position: node.getStart(file) })
  }

  /** Build a {@link DiagnosticError} anchored at the start of AST `node`. */
  static at({
    code,
    message,
    node,
  }: {
    code: DiagnosticCode
    message: string
    node: Node
  }): DiagnosticError {
    return new DiagnosticError({ code, message, ...DiagnosticError.placeAt(node) })
  }

  /** Build a {@link DiagnosticError} anchored at line 1, column 1 of `file`. */
  static atFile({
    code,
    message,
    file,
    cause,
  }: {
    code: DiagnosticCode
    message: string
    file: string
    cause?: unknown
  }): DiagnosticError {
    return new DiagnosticError({
      code,
      message,
      file,
      line: 1,
      column: 1,
      ...(cause !== undefined && { cause }),
    })
  }

  /** Convert a TypeScript diagnostic in `file` into a modkit `'type-error'` {@link DiagnosticError}. */
  static fromTypeScript({
    error,
    file,
  }: {
    error: TsDiagnostic
    file: SourceFile
  }): DiagnosticError {
    return new DiagnosticError({
      code: 'type-error',
      message: error.text,
      ...placeOf({ file, position: error.pos }),
    })
  }

  /** Return a copy of this diagnostic with `file` replaced (for relative display paths). */
  withFile(file: string): DiagnosticError {
    return new DiagnosticError({
      code: this.code,
      message: this.message,
      file,
      line: this.line,
      column: this.column,
    })
  }

  /** Format this diagnostic as `<file>:<line>:<column>: <code>: <message>`. */
  format(): string {
    return `${this.file}:${this.line}:${this.column}: ${this.code}: ${this.message}`
  }
}
