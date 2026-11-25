/**
 * AST traversal and symbol resolution helpers for `@atuin/modkit` imports inside a mod project.
 *
 * @module
 */

import { SymbolFlags, syntax, type Node, type Project, type TsSymbol } from './program.ts'

const MODKIT: ReadonlySet<string> = new Set(['@atuin/modkit', '@atuin/modkit/ui/hooks'])

/** Return all unique resolved symbols exported by `@atuin/modkit` as imported in `project`. */
export function modkitExports(project: Project): TsSymbol[] {
  const { checker } = project
  const specifiers = project.files.flatMap((file) =>
    file.statements.flatMap((statement) =>
      syntax.isImportDeclaration(statement) &&
      syntax.isStringLiteral(statement.moduleSpecifier) &&
      MODKIT.has(statement.moduleSpecifier.text)
        ? [statement.moduleSpecifier]
        : [],
    ),
  )
  const exported = specifiers.flatMap((specifier) => [
    ...(checker.getSymbolAtLocation(specifier)?.getExports().values() ?? []),
  ])
  const resolved = exported.map((symbol) =>
    (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol),
  )
  return [...new Map(resolved.map((symbol) => [symbol.id, symbol])).values()]
}

/** Collect every call expression within `node`, including nested calls. */
export function callsIn(node: Node): syntax.CallExpression[] {
  const found: syntax.CallExpression[] = []
  const visit = (child: Node): void => {
    if (syntax.isCallExpression(child)) found.push(child)
    child.forEachChild(visit)
  }
  visit(node)
  return found
}
