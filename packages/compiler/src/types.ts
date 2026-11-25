/**
 * Converts a TypeScript {@link Type} into a structural JSON {@link Shape}, or reports the first
 * non-JSON member encountered.
 *
 * Accepts strings, numbers, booleans, `null`, literals, arrays, tuples, and plain object types
 * (with `undefined` permitted only on optional properties). Branded primitives such as
 * `string & { __brand: 'Id' }` collapse to their underlying primitive. Built-in non-array library
 * interfaces (`Date`, `Map`, `Promise`), classes, functions, `any`, `unknown`, `bigint`, and
 * `symbol` are rejected.
 *
 * @module
 */

import {
  ElementFlags,
  SignatureKind,
  SymbolFlags,
  TypeFlags,
  hasAnyFlag,
  isBooleanLiteralType,
  isIntersectionType,
  isNumberLiteralType,
  isStringLiteralType,
  isTupleType,
  isTypeReference,
  isUnionType,
  type Checker,
  type Program,
  type TsSymbol,
  type Type,
} from './program.ts'
import type { Field, Item, Shape } from './shape.ts'

interface NotJson {
  path: string
  found: string
}

/** Result of converting a TypeScript type to a JSON {@link Shape}. */
export type ShapeResult = { isJson: true; shape: Shape } | { isJson: false; notJson: NotJson }

class NotJsonError extends Error {
  readonly notJson: NotJson

  constructor(notJson: NotJson) {
    super(`${notJson.found} at ${notJson.path}`)
    this.notJson = notJson
  }
}

interface Walk {
  readonly checker: Checker
  readonly program: Program
  readonly path: string
  readonly within: readonly number[]
}

const PRIMITIVE =
  TypeFlags.String |
  TypeFlags.Number |
  TypeFlags.Boolean |
  TypeFlags.StringLiteral |
  TypeFlags.NumberLiteral |
  TypeFlags.BooleanLiteral |
  TypeFlags.TemplateLiteral

const REFUSED: readonly [number, string][] = [
  [TypeFlags.Any, 'any'],
  [TypeFlags.Unknown, 'unknown'],
  [TypeFlags.Never, 'never'],
  [TypeFlags.Void, 'void'],
  [TypeFlags.Undefined, 'undefined'],
  [TypeFlags.BigInt | TypeFlags.BigIntLiteral, 'a bigint'],
  [TypeFlags.ESSymbol | TypeFlags.UniqueESSymbol, 'a symbol'],
  [TypeFlags.TypeParameter, 'a type parameter'],
  [TypeFlags.NonPrimitive, 'the `object` type'],
]

function refuse({ walk, found }: { walk: Walk; found: string }): never {
  throw new NotJsonError({ path: walk.path, found })
}

const into = ({ walk, step, container }: { walk: Walk; step: string; container: Type }): Walk => ({
  ...walk,
  path: `${walk.path}${step}`,
  within: [...walk.within, container.id],
})

function isLibraryInterface({ walk, symbol }: { walk: Walk; symbol: TsSymbol }): boolean {
  if ((symbol.flags & SymbolFlags.Interface) === 0) return false
  return symbol.declarations.some((declaration) => {
    const file = walk.program.getSourceFile(declaration.path)
    return file !== undefined && walk.program.isSourceFileDefaultLibrary(file)
  })
}

function presentShape({ walk, type }: { walk: Walk; type: Type }): Shape {
  if (!isUnionType(type)) return shapeIn(walk, type)
  const present = type
    .getTypes()
    .filter((member) => !hasAnyFlag({ type: member, flags: TypeFlags.Undefined }))
  return { kind: 'union', of: present.map((member) => shapeIn(walk, member)) }
}

function fieldOf({
  walk,
  container,
  property,
}: {
  walk: Walk
  container: Type
  property: TsSymbol
}): Field {
  const optional = (property.flags & SymbolFlags.Optional) !== 0
  const inner = into({ walk, step: `.${property.name}`, container })
  const type = walk.checker.getTypeOfSymbol(property)
  if (type === undefined) {
    return refuse({ walk: inner, found: 'a field TypeScript has no type for' })
  }
  return {
    name: property.name,
    shape: optional ? presentShape({ walk: inner, type }) : shapeIn(inner, type),
    optional,
  }
}

function objectShape(walk: Walk, type: Type): Shape {
  const { checker } = walk
  const signatures = [SignatureKind.Call, SignatureKind.Construct].flatMap((kind) =>
    checker.getSignaturesOfType(type, kind),
  )
  if (signatures.length > 0) refuse({ walk, found: 'a function' })
  const symbol = type.getSymbol()
  if (symbol !== undefined && (symbol.flags & SymbolFlags.Class) !== 0) {
    refuse({ walk, found: `an instance of ${symbol.name}` })
  }
  if (symbol !== undefined && isLibraryInterface({ walk, symbol })) {
    refuse({ walk, found: `a ${symbol.name}` })
  }
  const [index] = checker.getIndexInfosOfType(type)
  return {
    kind: 'object',
    fields: checker
      .getPropertiesOfType(type)
      .map((property) => fieldOf({ walk, container: type, property })),
    index:
      index === undefined
        ? undefined
        : shapeIn(into({ walk, step: '[key]', container: type }), index.valueType),
  }
}

function elementOf(flag: ElementFlags): Item['element'] {
  if ((flag & (ElementFlags.Rest | ElementFlags.Variadic)) !== 0) return 'rest'
  return (flag & ElementFlags.Optional) === 0 ? 'required' : 'optional'
}

function itemsOf(walk: Walk, type: Type): Item[] | undefined {
  if (!isTypeReference(type)) return undefined
  const target = type.getTarget()
  if (!isTupleType(target)) return undefined
  return walk.checker.getTypeArguments(type).map((element, position) => ({
    shape: shapeIn(into({ walk, step: `[${position}]`, container: type }), element),
    element: elementOf(target.elementFlags[position] ?? ElementFlags.Required),
  }))
}

function primitiveOf(walk: Walk, type: Type): Shape | undefined {
  if (hasAnyFlag({ type, flags: TypeFlags.Null })) return { kind: 'null' }
  if (hasAnyFlag({ type, flags: TypeFlags.Boolean })) return { kind: 'boolean' }
  if (
    hasAnyFlag({
      type,
      flags: TypeFlags.String | TypeFlags.TemplateLiteral | TypeFlags.StringMapping,
    })
  ) {
    return { kind: 'string' }
  }
  if (hasAnyFlag({ type, flags: TypeFlags.Number })) return { kind: 'number' }
  if (isStringLiteralType(type) || isNumberLiteralType(type) || isBooleanLiteralType(type)) {
    return { kind: 'literal', value: type.value }
  }
  const refused = REFUSED.find(([flags]) => hasAnyFlag({ type, flags }))
  return refused === undefined ? undefined : refuse({ walk, found: refused[1] })
}

function shapeIn(walk: Walk, type: Type): Shape {
  const at = walk.within.lastIndexOf(type.id)
  if (at !== -1) return { kind: 'self', up: walk.within.length - at }
  const primitive = primitiveOf(walk, type)
  if (primitive !== undefined) return primitive
  if (isUnionType(type)) {
    return { kind: 'union', of: type.getTypes().map((member) => shapeIn(walk, member)) }
  }
  if (isIntersectionType(type)) {
    const brand = type.getTypes().find((member) => hasAnyFlag({ type: member, flags: PRIMITIVE }))
    return brand === undefined ? objectShape(walk, type) : shapeIn(walk, brand)
  }
  if (!hasAnyFlag({ type, flags: TypeFlags.Object })) {
    return refuse({ walk, found: walk.checker.typeToString(type) })
  }
  if (isTypeReference(type) && walk.checker.isArrayType(type)) {
    const [element] = walk.checker.getTypeArguments(type)
    if (element === undefined) return refuse({ walk, found: 'an array of no element type' })
    return { kind: 'array', of: shapeIn(into({ walk, step: '[]', container: type }), element) }
  }
  const items = itemsOf(walk, type)
  return items === undefined ? objectShape(walk, type) : { kind: 'tuple', items }
}

/** Walk `type` into a JSON {@link Shape}, or return the path and kind of the first bad node. */
export function shapeOf({
  checker,
  program,
  type,
}: {
  checker: Checker
  program: Program
  type: Type
}): ShapeResult {
  try {
    return { isJson: true, shape: shapeIn({ checker, program, path: '', within: [] }, type) }
  } catch (error) {
    if (error instanceof NotJsonError) return { isJson: false, notJson: error.notJson }
    throw error
  }
}
