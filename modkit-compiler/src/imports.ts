import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import { syntax, type Node, type Project } from './program.ts'

// The engine and the toolchain a target runs a mod with; a mod's own code reaches them only through
// `@atuin/modkit`.
function isTargetsOnly({
  specifier,
  targetPackages,
}: {
  specifier: string
  targetPackages: ReadonlySet<string>
}): boolean {
  if (specifier === '@atuin/modkit/host' || specifier.startsWith('@atuin/modkit-')) return true
  for (const pkg of targetPackages) {
    if (specifier === pkg || specifier.startsWith(`${pkg}/`)) return true
  }
  return false
}

// What names the module `node` imports, when it imports one: an import or export declaration's
// specifier, an `import()` call's argument, or an `import()` type's.
function specifierOf(node: Node): Node | undefined {
  if (syntax.isImportDeclaration(node) || syntax.isExportDeclaration(node)) {
    return node.moduleSpecifier
  }
  if (syntax.isCallExpression(node) && syntax.isImportExpression(node.expression)) {
    return node.arguments[0]
  }
  if (syntax.isImportTypeNode(node) && syntax.isLiteralTypeNode(node.argument)) {
    return node.argument.literal
  }
  return undefined
}

// Every module `node` and the nodes under it import by a literal name.
function importedIn(node: Node): (syntax.StringLiteral | syntax.NoSubstitutionTemplateLiteral)[] {
  const specifier = specifierOf(node)
  const found =
    specifier !== undefined &&
    (syntax.isStringLiteral(specifier) || syntax.isNoSubstitutionTemplateLiteral(specifier))
      ? [specifier]
      : []
  node.forEachChild((child) => {
    found.push(...importedIn(child))
  })
  return found
}

/**
 * Every import, re-export, `import()` call and `import()` type in the mod's files of something only
 * a target may import.
 */
export function hostImportsIn(
  project: Project,
  targetPackages: readonly string[] = [],
): Diagnostic[] {
  const blocked = new Set(targetPackages)
  return project.files.flatMap((file) =>
    importedIn(file).flatMap((specifier) => {
      if (!isTargetsOnly({ specifier: specifier.text, targetPackages: blocked })) return []
      const message = `a mod imports @atuin/modkit, not ${specifier.text}, which is what a target runs it with`
      return [diagnosticAt({ code: 'host-import', message, node: specifier })]
    }),
  )
}
