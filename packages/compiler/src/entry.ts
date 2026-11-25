import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import { modkitExports } from './modkit.ts'
import { resolvedSymbol, syntax, type Node, type Project, type SourceFile } from './program.ts'

type SetupNode = syntax.ArrowFunction | syntax.FunctionExpression

export interface ModCall {
  call: syntax.CallExpression
  setup: SetupNode
  parts: readonly syntax.ObjectLiteralExpression[]
}

const NO_MOD =
  "a mod is mod.tsx's default export, written `export default mod((settings) => ({ ... }))`"

const none = (node: Node) => diagnosticAt({ code: 'no-mod', message: NO_MOD, node })

const unwrapped = (node: Node): Node =>
  syntax.isParenthesizedExpression(node) ||
  syntax.isAsExpression(node) ||
  syntax.isSatisfiesExpression(node)
    ? unwrapped(node.expression)
    : node

function returnedIn(node: Node): Node[] {
  if (syntax.isReturnStatement(node)) return node.expression === undefined ? [] : [node.expression]
  if (
    syntax.isFunctionDeclaration(node) ||
    syntax.isFunctionExpression(node) ||
    syntax.isArrowFunction(node)
  ) {
    return []
  }
  const found: Node[] = []
  node.forEachChild((child) => {
    found.push(...returnedIn(child))
  })
  return found
}

function partsOf(setup: SetupNode): syntax.ObjectLiteralExpression[] | Diagnostic {
  const returned = syntax.isBlock(setup.body) ? returnedIn(setup.body) : [setup.body]
  const literals = returned.map((one) => unwrapped(one))
  const other = literals.find((one) => !syntax.isObjectLiteralExpression(one))
  if (other !== undefined || literals.length === 0) {
    const message =
      "a mod's function returns its parts as an object literal, which the build reads its tools from"
    return diagnosticAt({ code: 'mod-parts', message, node: other ?? setup })
  }
  return literals.filter((one) => syntax.isObjectLiteralExpression(one))
}

export function modCallIn({
  project,
  entry,
}: {
  project: Project
  entry: SourceFile
}): ModCall | Diagnostic {
  const exported = entry.statements.find(
    (statement) => syntax.isExportAssignment(statement) && !statement.isExportEquals,
  )
  if (exported === undefined || !syntax.isExportAssignment(exported)) return none(entry)
  const call = unwrapped(exported.expression)
  if (!syntax.isCallExpression(call)) return none(exported)
  const mod = modkitExports(project).find((symbol) => symbol.name === 'mod')
  const called = resolvedSymbol({ checker: project.checker, node: call.expression })
  if (mod === undefined || called?.id !== mod.id) return none(exported)
  const [setup] = call.arguments
  if (
    setup === undefined ||
    !(syntax.isArrowFunction(setup) || syntax.isFunctionExpression(setup))
  ) {
    return none(call)
  }
  const parts = partsOf(setup)
  return Array.isArray(parts) ? { call, setup, parts } : parts
}

function nameOf(property: syntax.ObjectLiteralElementLike): string | undefined {
  if (syntax.isSpreadAssignment(property)) return undefined
  const { name } = property
  return syntax.isIdentifier(name) || syntax.isStringLiteral(name) ? name.text : undefined
}

export function partsNamed({ mod, name }: { mod: ModCall; name: string }): Node[] {
  return mod.parts.flatMap((literal) =>
    literal.properties.flatMap((property): Node[] => {
      if (nameOf(property) !== name) return []
      if (syntax.isPropertyAssignment(property)) return [unwrapped(property.initializer)]
      return [property]
    }),
  )
}

export function keysOf(node: Node): string[] | undefined {
  if (!syntax.isObjectLiteralExpression(node)) return undefined
  const keys = node.properties.map((property) => nameOf(property))
  return keys.every((key) => key !== undefined) ? keys : undefined
}
