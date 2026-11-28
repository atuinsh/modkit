/**
 * AST traversal and symbol resolution helpers for `@atuin/modkit` imports inside a mod project.
 *
 * @module
 */

import { SymbolFlags, syntax, type Node, type TsProject, type TsSymbol } from './program.ts'

const MODKIT: ReadonlySet<string> = new Set(['@atuin/modkit', '@atuin/modkit/ui/hooks'])

/** AST symbol and call-expression queries bound to a {@link TsProject}. */
export class ModkitSymbols {
  readonly #project: TsProject

  constructor(project: TsProject) {
    this.#project = project
  }

  /** Collect every call expression within `node`, including nested calls. */
  static callsIn(node: Node): syntax.CallExpression[] {
    const found: syntax.CallExpression[] = []
    const visit = (child: Node): void => {
      if (syntax.isCallExpression(child)) found.push(child)
      child.forEachChild(visit)
    }
    visit(node)
    return found
  }

  /** Return all unique resolved symbols exported by `@atuin/modkit` as imported in this project. */
  exports(): TsSymbol[] {
    const { checker, files } = this.#project
    const specifiers = files.flatMap((file) =>
      file.statements.flatMap((statement) =>
        syntax.isImportDeclaration(statement) &&
        syntax.isStringLiteral(statement.moduleSpecifier) &&
        MODKIT.has(statement.moduleSpecifier.text)
          ? [statement.moduleSpecifier]
          : [],
      ),
    )
    const exported = specifiers.flatMap(
      (specifier) => checker.getSymbolAtLocation(specifier)?.getExports().values().toArray() ?? [],
    )
    const resolved = exported.map((symbol) =>
      (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol),
    )
    return new Map(resolved.map((symbol) => [symbol.id, symbol])).values().toArray()
  }
}
