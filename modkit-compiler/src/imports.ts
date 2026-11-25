import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import { syntax, type Node, type Project } from './program.ts'

// The engine and the toolchain a target runs a mod with; a mod's own code reaches them only through
// `@atuin/modkit`.
const isTargetsOnly = (specifier: string): boolean =>
  specifier === '@atuin/modkit/host' || specifier.startsWith('@atuin/modkit-')

function specifierOf(statement: Node): syntax.StringLiteral | undefined {
  if (!syntax.isImportDeclaration(statement) && !syntax.isExportDeclaration(statement)) {
    return undefined
  }
  const { moduleSpecifier } = statement
  return moduleSpecifier !== undefined && syntax.isStringLiteral(moduleSpecifier)
    ? moduleSpecifier
    : undefined
}

/** Every import or re-export in the mod's files of something only a target may import. */
export function hostImportsIn(project: Project): Diagnostic[] {
  return project.files.flatMap((file) =>
    file.statements.flatMap((statement) => {
      const moduleSpecifier = specifierOf(statement)
      if (moduleSpecifier === undefined || !isTargetsOnly(moduleSpecifier.text)) return []
      const message = `a mod imports @atuin/modkit, not ${moduleSpecifier.text}, which is what a target runs it with`
      return [diagnosticAt({ code: 'host-import', message, node: moduleSpecifier })]
    }),
  )
}
