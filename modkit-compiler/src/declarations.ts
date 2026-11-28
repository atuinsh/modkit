import { relative } from 'node:path'

import { ModDiagnostic, type Diagnostic } from './diagnostics.ts'
import type { StateDecl, StateKind } from './ir.ts'
import { ModkitSymbols } from './modkit.ts'
import {
  isStringLiteralType,
  isTypeReference,
  syntax,
  type TsProject,
  type Type,
} from './program.ts'
import { JsonShape } from './shape.ts'
import { TypeShape } from './types.ts'

// Where each declaration's value type sits among its return type's arguments: `State<T>`,
// `Query<I, T>`.
const VALUE_ARGUMENT: Readonly<Record<StateKind, number>> = { state: 0, query: 1 }

const isKind = (name: string): name is StateKind => Object.hasOwn(VALUE_ARGUMENT, name)

interface Declared extends StateDecl {
  call: syntax.CallExpression
}

type Found =
  | { isDeclared: true; declared: Declared }
  | { isDeclared: false; diagnostic: Diagnostic }

/** A `state()` or `query()` call in the mod, which declares one value the mod keeps. */
class StateCall {
  readonly #project: TsProject
  readonly #call: syntax.CallExpression
  readonly #kind: StateKind

  constructor({
    project,
    call,
    kind,
  }: {
    project: TsProject
    call: syntax.CallExpression
    kind: StateKind
  }) {
    this.#project = project
    this.#call = call
    this.#kind = kind
  }

  /** The declaration the call makes, or the diagnostic saying why it makes none. */
  declared(): Found {
    const kind = this.#kind
    const id = this.#id()
    if (id === undefined) {
      return this.#fail(
        'state-id',
        `${kind}() takes an object literal whose id is a string literal: its value is stored under it`,
      )
    }
    const held = this.#held()
    if (held === undefined) {
      return this.#fail('state-not-json', `TypeScript gives ${id} no value type`)
    }
    const shaped = TypeShape.in(this.#project).of(held)
    if (!shaped.isJson) {
      const where = shaped.notJson.path === '' ? 'as its value' : `at ${shaped.notJson.path}`
      return this.#fail(
        'state-not-json',
        `${id} can't hold ${shaped.notJson.found} ${where}: a mod's state is JSON`,
      )
    }
    const jsonShape = JsonShape.of(shaped.shape)
    return {
      isDeclared: true,
      declared: {
        id,
        kind,
        shape: jsonShape.canonical(),
        tag: jsonShape.tag(),
        call: this.#call,
      },
    }
  }

  // The id the call's object literal names, if it is a string literal.
  #id(): string | undefined {
    const [declaration] = this.#call.arguments
    if (declaration === undefined || !syntax.isObjectLiteralExpression(declaration)) {
      return undefined
    }
    const id = declaration.properties.find(
      (property): property is syntax.PropertyAssignment =>
        syntax.isPropertyAssignment(property) &&
        syntax.isIdentifier(property.name) &&
        property.name.text === 'id',
    )
    if (id === undefined) return undefined
    const type = this.#project.checker.getTypeAtLocation(id.initializer)
    return type !== undefined && isStringLiteralType(type) ? type.value : undefined
  }

  // The value type the call's return type holds: `T` of `State<T>`, or of `Query<I, T>`.
  #held(): Type | undefined {
    const { checker } = this.#project
    const returned = checker.getTypeAtLocation(this.#call)
    return returned !== undefined && isTypeReference(returned)
      ? checker.getTypeArguments(returned)[VALUE_ARGUMENT[this.#kind]]
      : undefined
  }

  #fail(code: Diagnostic['code'], message: string): Found {
    return { isDeclared: false, diagnostic: ModDiagnostic.at({ code, message, node: this.#call }) }
  }
}

function duplicatesIn({
  project,
  declared,
}: {
  project: TsProject
  declared: readonly Declared[]
}): Diagnostic[] {
  const first = new Map<string, Declared>()
  return declared.flatMap((one) => {
    const earlier = first.get(one.id)
    if (earlier === undefined) {
      first.set(one.id, one)
      return []
    }
    const file = earlier.call.getSourceFile()
    const { line } = file.getLineAndCharacterOfPosition(earlier.call.getStart(file))
    const where = `${relative(project.dir, file.fileName)}:${line + 1}`
    const message = `${one.id} is also the id declared at ${where}; give one another`
    return [ModDiagnostic.at({ code: 'duplicate-state', message, node: one.call })]
  })
}

export function declarationsIn(project: TsProject): {
  state: StateDecl[]
  diagnostics: Diagnostic[]
} {
  const kinds = new Map(
    new ModkitSymbols(project)
      .exports()
      .flatMap((symbol) => (isKind(symbol.name) ? [[symbol.id, symbol.name] as const] : [])),
  )
  const found = project.files.flatMap((file) =>
    ModkitSymbols.callsIn(file).flatMap((call): Found[] => {
      const symbol = project.resolveSymbol(call.expression)
      const kind = symbol === undefined ? undefined : kinds.get(symbol.id)
      return kind === undefined ? [] : [new StateCall({ project, call, kind }).declared()]
    }),
  )
  const declared = found.flatMap((one) => (one.isDeclared ? [one.declared] : []))
  const problems = found.flatMap((one) => (one.isDeclared ? [] : [one.diagnostic]))
  return {
    state: declared.map(({ id, kind, tag, shape }) => ({ id, kind, tag, shape })),
    diagnostics: [...problems, ...duplicatesIn({ project, declared })],
  }
}
