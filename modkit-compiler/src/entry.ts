import { ModDiagnostic, type Diagnostic } from './diagnostics.ts'
import { ModkitSymbols } from './modkit.ts'
import { syntax, type Node, type SourceFile, type TsProject } from './program.ts'

type SetupNode = syntax.ArrowFunction | syntax.FunctionExpression

const NO_MOD =
  "a mod is mod.tsx's default export, written `export default mod((settings) => ({ ... }))`"

const none = (node: Node): Diagnostic => ModDiagnostic.at({ code: 'no-mod', message: NO_MOD, node })

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
    return ModDiagnostic.at({ code: 'mod-parts', message, node: other ?? setup })
  }
  return literals.filter((one) => syntax.isObjectLiteralExpression(one))
}

function nameOf(property: syntax.ObjectLiteralElementLike): string | undefined {
  if (syntax.isSpreadAssignment(property)) return undefined
  const { name } = property
  return syntax.isIdentifier(name) || syntax.isStringLiteral(name) ? name.text : undefined
}

// A part the build can't name, so can't read tools from or check against what a target provides: a
// spread, or a computed key.
function unnamedIn(parts: readonly syntax.ObjectLiteralExpression[]): Diagnostic | undefined {
  const unnamed = parts
    .flatMap((part) => part.properties)
    .find((property) => nameOf(property) === undefined)
  if (unnamed === undefined) return undefined
  const message =
    "a mod's parts object names each of its parts, which the build reads; write `status: ...`, not a spread or a computed key"
  return ModDiagnostic.at({ code: 'mod-parts', message, node: unnamed })
}

const isSetup = (node: Node): node is SetupNode =>
  syntax.isArrowFunction(node) || syntax.isFunctionExpression(node)

function defaultCallIn(
  entry: SourceFile,
): { exported: Node; call: syntax.CallExpression } | Diagnostic {
  const exported = entry.statements.find(
    (statement) => syntax.isExportAssignment(statement) && !statement.isExportEquals,
  )
  if (exported === undefined || !syntax.isExportAssignment(exported)) return none(entry)
  const call = unwrapped(exported.expression)
  return syntax.isCallExpression(call) ? { exported, call } : none(exported)
}

/** Parsed AST representation of a mod's `export default mod((settings) => ({ ... }))` entry. */
export class ModAst {
  readonly #setup: SetupNode
  readonly #parts: readonly syntax.ObjectLiteralExpression[]

  private constructor({
    setup,
    parts,
  }: {
    setup: SetupNode
    parts: readonly syntax.ObjectLiteralExpression[]
  }) {
    this.#setup = setup
    this.#parts = parts
  }

  /** Locate and validate `export default mod(...)` in `entry`, or return its diagnostic. */
  static from({ project, entry }: { project: TsProject; entry: SourceFile }): ModAst | Diagnostic {
    const found = defaultCallIn(entry)
    if ('code' in found) return found
    const { exported, call } = found
    const mod = new ModkitSymbols(project).exports().find((symbol) => symbol.name === 'mod')
    const called = project.resolveSymbol(call.expression)
    if (mod === undefined || called?.id !== mod.id) return none(exported)
    const [setup] = call.arguments
    if (setup === undefined || !isSetup(setup)) return none(call)
    const parts = partsOf(setup)
    if (!Array.isArray(parts)) return parts
    return unnamedIn(parts) ?? new ModAst({ setup, parts })
  }

  /** Static property names of an object literal expression, or `undefined` if any key is computed/spread. */
  static keysOf(node: Node): string[] | undefined {
    if (!syntax.isObjectLiteralExpression(node)) return undefined
    const keys = node.properties.map((property) => nameOf(property))
    return keys.every((key) => key !== undefined) ? keys : undefined
  }

  get setup(): SetupNode {
    return this.#setup
  }

  /** Return all initializer/property AST nodes named `name` across every returned parts object. */
  parts(name: string): Node[] {
    return this.#parts.flatMap((literal) =>
      literal.properties.flatMap((property): Node[] => {
        if (nameOf(property) !== name) return []
        if (syntax.isPropertyAssignment(property)) return [unwrapped(property.initializer)]
        return [property]
      }),
    )
  }
}
