/**
 * Isolation wrapper around TypeScript 7's `typescript/unstable/*` compiler API.
 *
 * This is the only module in the compiler that imports TypeScript directly, keeping unstable API
 * changes confined to one file. Opening a {@link TsProject} spawns a background `tsgo` process that
 * lives until it is disposed.
 *
 * @module
 */

import { dirname } from 'node:path'

import type { Node, SourceFile } from 'typescript/unstable/ast'
import {
  API,
  DiagnosticCategory,
  SymbolFlags,
  type Checker,
  type Diagnostic,
  type Program,
  type Symbol as TsSymbol,
  type Type,
} from 'typescript/unstable/sync'

export * as syntax from 'typescript/unstable/ast'
export type { Node, SourceFile } from 'typescript/unstable/ast'
export {
  ElementFlags,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
  isBooleanLiteralType,
  isIntersectionType,
  isNumberLiteralType,
  isStringLiteralType,
  isTupleType,
  isTypeReference,
  isUnionType,
  type Checker,
  type Diagnostic,
  type Program,
  type Symbol as TsSymbol,
  type Type,
} from 'typescript/unstable/sync'

/** An open TypeScript project backed by a `tsgo` process. Dispose via `using` when finished. */
export class TsProject implements Disposable {
  readonly #api: API
  readonly #tsconfig: string
  readonly #dir: string
  readonly #checker: Checker
  readonly #program: Program
  readonly #files: readonly SourceFile[]

  private constructor({
    api,
    tsconfig,
    checker,
    program,
    files,
  }: {
    api: API
    tsconfig: string
    checker: Checker
    program: Program
    files: readonly SourceFile[]
  }) {
    this.#api = api
    this.#tsconfig = tsconfig
    this.#dir = dirname(tsconfig)
    this.#checker = checker
    this.#program = program
    this.#files = files
  }

  /** Open a TypeScript {@link TsProject} configured by `tsconfig`. Dispose via `using` when finished. */
  static open(tsconfig: string): TsProject {
    const api = new API({ cwd: dirname(tsconfig) })
    return TsProject.#fromSnapshot({
      api,
      tsconfig,
      snapshot: api.updateSnapshot({ openProjects: [tsconfig] }),
    })
  }

  /** Return `true` if `type.flags` shares any bit with `flags`. */
  static hasAnyFlag({ type, flags }: { type: Type; flags: number }): boolean {
    return (type.flags & flags) !== 0
  }

  static #fromSnapshot({
    api,
    tsconfig,
    snapshot,
  }: {
    api: API
    tsconfig: string
    snapshot: ReturnType<API['updateSnapshot']>
  }): TsProject {
    const project = snapshot.getProject(tsconfig)
    if (project === undefined) throw new Error(`TypeScript opened no project for ${tsconfig}`)
    const { program, checker } = project
    const files = program
      .getSourceFileNames()
      .flatMap((name) => program.getSourceFile(name) ?? [])
      .filter(
        (file) =>
          !program.isSourceFileFromExternalLibrary(file) &&
          !program.isSourceFileDefaultLibrary(file),
      )
    return new TsProject({ api, tsconfig, checker, program, files })
  }

  /** Absolute path to the project's `tsconfig.json`. */
  get tsconfig(): string {
    return this.#tsconfig
  }

  /** Directory containing `tsconfig.json`. */
  get dir(): string {
    return this.#dir
  }

  get checker(): Checker {
    return this.#checker
  }

  get program(): Program {
    return this.#program
  }

  /** The mod's own source files, excluding `node_modules` and TypeScript default libraries. */
  get files(): readonly SourceFile[] {
    return this.#files
  }

  /** Return an updated {@link TsProject} snapshot reflecting on-disk edits to `files`. */
  refresh(files: readonly string[]): TsProject {
    return TsProject.#fromSnapshot({
      api: this.#api,
      tsconfig: this.#tsconfig,
      snapshot: this.#api.updateSnapshot({ fileChanges: { changed: [...files] } }),
    })
  }

  /**
   * Return deduplicated project-level TypeScript errors (config, program, and global diagnostics).
   *
   * TypeScript can emit the same error across multiple diagnostic lists, so duplicates by
   * `(fileName, pos, text)` are filtered out.
   */
  projectErrors(): readonly Diagnostic[] {
    const all = [
      ...this.#program.getConfigFileParsingDiagnostics(),
      ...this.#program.getProgramDiagnostics(),
      ...this.#program.getGlobalDiagnostics(),
    ].filter((one) => one.category === DiagnosticCategory.Error)
    const seen = new Set<string>()
    return all.filter((one) => {
      const key = `${one.fileName ?? ''}:${one.pos}:${one.text}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /** Return all syntactic and semantic TypeScript diagnostics for `file`. */
  fileErrors(file: SourceFile): readonly Diagnostic[] {
    return [
      ...this.#program.getSyntacticDiagnostics(file.fileName),
      ...this.#program.getSemanticDiagnostics(file.fileName),
    ]
  }

  /** Resolve the symbol referenced by `node`, following import and re-export aliases. */
  resolveSymbol(node: Node): TsSymbol | undefined {
    const symbol = this.#checker.getSymbolAtLocation(node)
    if (symbol === undefined || (symbol.flags & SymbolFlags.Alias) === 0) return symbol
    return this.#checker.getAliasedSymbol(symbol)
  }

  [Symbol.dispose](): void {
    this.#api.close()
  }
}
