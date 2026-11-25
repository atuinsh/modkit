import { relative } from 'node:path'

import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import type { StateDecl, StateKind } from './ir.ts'
import { callsIn, modkitExports } from './modkit.ts'
import {
  isStringLiteralType,
  isTypeReference,
  resolvedSymbol,
  syntax,
  type Project,
} from './program.ts'
import { canonical, tagOf } from './shape.ts'
import { shapeOf } from './types.ts'

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

function idOf({
  project,
  call,
}: {
  project: Project
  call: syntax.CallExpression
}): string | undefined {
  const [declaration] = call.arguments
  if (declaration === undefined || !syntax.isObjectLiteralExpression(declaration)) return undefined
  const id = declaration.properties.find(
    (property): property is syntax.PropertyAssignment =>
      syntax.isPropertyAssignment(property) &&
      syntax.isIdentifier(property.name) &&
      property.name.text === 'id',
  )
  if (id === undefined) return undefined
  const type = project.checker.getTypeAtLocation(id.initializer)
  return type !== undefined && isStringLiteralType(type) ? type.value : undefined
}

function declaredBy({
  project,
  call,
  kind,
}: {
  project: Project
  call: syntax.CallExpression
  kind: StateKind
}): Found {
  const fail = (code: Diagnostic['code'], message: string): Found => ({
    isDeclared: false,
    diagnostic: diagnosticAt({ code, message, node: call }),
  })
  const id = idOf({ project, call })
  if (id === undefined) {
    return fail(
      'state-id',
      `${kind}() takes an object literal whose id is a string literal: its value is stored under it`,
    )
  }
  const returned = project.checker.getTypeAtLocation(call)
  const held =
    returned !== undefined && isTypeReference(returned)
      ? project.checker.getTypeArguments(returned)[VALUE_ARGUMENT[kind]]
      : undefined
  if (held === undefined) return fail('state-not-json', `TypeScript gives ${id} no value type`)
  const shaped = shapeOf({ checker: project.checker, program: project.program, type: held })
  if (!shaped.isJson) {
    const where = shaped.notJson.path === '' ? 'as its value' : `at ${shaped.notJson.path}`
    return fail(
      'state-not-json',
      `${id} can't hold ${shaped.notJson.found} ${where}: a mod's state is JSON`,
    )
  }
  return {
    isDeclared: true,
    declared: { id, kind, shape: canonical(shaped.shape), tag: tagOf(shaped.shape), call },
  }
}

function duplicatesIn({
  project,
  declared,
}: {
  project: Project
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
    return [diagnosticAt({ code: 'duplicate-state', message, node: one.call })]
  })
}

export function declarationsIn(project: Project): {
  state: StateDecl[]
  diagnostics: Diagnostic[]
} {
  const kinds = new Map(
    modkitExports(project).flatMap((symbol) =>
      isKind(symbol.name) ? [[symbol.id, symbol.name] as const] : [],
    ),
  )
  const found = project.files.flatMap((file) =>
    callsIn(file).flatMap((call): Found[] => {
      const symbol = resolvedSymbol({ checker: project.checker, node: call.expression })
      const kind = symbol === undefined ? undefined : kinds.get(symbol.id)
      return kind === undefined ? [] : [declaredBy({ project, call, kind })]
    }),
  )
  const declared = found.flatMap((one) => (one.isDeclared ? [one.declared] : []))
  const problems = found.flatMap((one) => (one.isDeclared ? [] : [one.diagnostic]))
  return {
    state: declared.map(({ id, kind, tag, shape }) => ({ id, kind, tag, shape })),
    diagnostics: [...problems, ...duplicatesIn({ project, declared })],
  }
}
