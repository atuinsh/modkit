/**
 * Isolation wrapper around TypeScript 7's `typescript/unstable/*` compiler API.
 *
 * This is the only module in the compiler that imports TypeScript directly, keeping unstable API
 * changes confined to one file. Opening a {@link Project} spawns a background `tsgo` process that
 * lives until {@link Project.close} is called.
 *
 * @module
 */

import { dirname } from 'node:path'

import type { Node, SourceFile } from 'typescript/unstable/ast'

export * as syntax from 'typescript/unstable/ast'
import {
  API,
  DiagnosticCategory,
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
}
export type { Checker, Diagnostic, Node, Program, SourceFile, TsSymbol, Type }

/** An open TypeScript project backed by a `tsgo` process. Call {@link close} when finished. */
export interface Project {
  /** Absolute path to the project's `tsconfig.json`. */
  readonly tsconfig: string
  /** Directory containing `tsconfig.json`. */
  readonly dir: string
  readonly checker: Checker
  readonly program: Program
  /** The mod's own source files, excluding `node_modules` and TypeScript default libraries. */
  readonly files: readonly SourceFile[]
  /** Return an updated {@link Project} snapshot reflecting on-disk edits to `files`. */
  refresh(files: readonly string[]): Project
  /** Shut down the underlying `tsgo` process. */
  close(): void
}

function projectOf({
  api,
  tsconfig,
  snapshot,
}: {
  api: API
  tsconfig: string
  snapshot: ReturnType<API['updateSnapshot']>
}): Project {
  const project = snapshot.getProject(tsconfig)
  if (project === undefined) throw new Error(`TypeScript opened no project for ${tsconfig}`)
  const { program, checker } = project
  const files = program
    .getSourceFileNames()
    .flatMap((name) => program.getSourceFile(name) ?? [])
    .filter(
      (file) =>
        !program.isSourceFileFromExternalLibrary(file) && !program.isSourceFileDefaultLibrary(file),
    )
  return {
    tsconfig,
    dir: dirname(tsconfig),
    checker,
    program,
    files,
    refresh: (changed) =>
      projectOf({
        api,
        tsconfig,
        snapshot: api.updateSnapshot({ fileChanges: { changed: [...changed] } }),
      }),
    close: () => {
      api.close()
    },
  }
}

/** Open a TypeScript {@link Project} configured by `tsconfig`. Caller must call `close()`. */
export function openProject({ tsconfig }: { tsconfig: string }): Project {
  const api = new API({ cwd: dirname(tsconfig) })
  return projectOf({ api, tsconfig, snapshot: api.updateSnapshot({ openProjects: [tsconfig] }) })
}

/**
 * Return deduplicated project-level TypeScript errors (config, program, and global diagnostics).
 *
 * TypeScript can emit the same error across multiple diagnostic lists, so duplicates by
 * `(fileName, pos, text)` are filtered out.
 */
export function projectErrorsIn(project: Project): readonly Diagnostic[] {
  const { program } = project
  const all = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getProgramDiagnostics(),
    ...program.getGlobalDiagnostics(),
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
export const errorsIn = ({
  project,
  file,
}: {
  project: Project
  file: SourceFile
}): readonly Diagnostic[] => [
  ...project.program.getSyntacticDiagnostics(file.fileName),
  ...project.program.getSemanticDiagnostics(file.fileName),
]

/** Resolve the symbol referenced by `node`, following import and re-export aliases. */
export function resolvedSymbol({
  checker,
  node,
}: {
  checker: Checker
  node: Node
}): TsSymbol | undefined {
  const symbol = checker.getSymbolAtLocation(node)
  if (symbol === undefined || (symbol.flags & SymbolFlags.Alias) === 0) return symbol
  return checker.getAliasedSymbol(symbol)
}

/** Return `true` if `type.flags` shares any bit with `flags`. */
export const hasAnyFlag = ({ type, flags }: { type: Type; flags: number }): boolean =>
  (type.flags & flags) !== 0
