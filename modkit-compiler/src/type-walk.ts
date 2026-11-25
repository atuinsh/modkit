import { NotJsonError } from './not-json.ts'
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

function elementOf(flag: ElementFlags): Item['element'] {
  if ((flag & (ElementFlags.Rest | ElementFlags.Variadic)) !== 0) return 'rest'
  return (flag & ElementFlags.Optional) === 0 ? 'required' : 'optional'
}

/**
 * A walk down a TypeScript type to its JSON {@link Shape}: where in the type it is, and the types
 * that enclose it there.
 *
 * Each step into a field, element or index is a new walk, so `path` names the part a refusal is
 * about and `within` finds the enclosing type a recursive one points back at.
 */
export class TypeWalk {
  readonly #checker: Checker
  readonly #program: Program
  readonly #path: string
  // The ids of the types enclosing this one, outermost first.
  readonly #within: readonly number[]

  constructor({
    checker,
    program,
    path = '',
    within = [],
  }: {
    checker: Checker
    program: Program
    path?: string
    within?: readonly number[]
  }) {
    this.#checker = checker
    this.#program = program
    this.#path = path
    this.#within = within
  }

  /** The shape of `type`; throws a {@link NotJsonError} at the first part of it that isn't JSON. */
  shapeOf(type: Type): Shape {
    const at = this.#within.lastIndexOf(type.id)
    if (at !== -1) return { kind: 'self', up: this.#within.length - at }
    const primitive = this.#primitiveOf(type)
    if (primitive !== undefined) return primitive
    if (isUnionType(type)) {
      return { kind: 'union', of: type.getTypes().map((member) => this.shapeOf(member)) }
    }
    if (isIntersectionType(type)) {
      const brand = type.getTypes().find((member) => hasAnyFlag({ type: member, flags: PRIMITIVE }))
      return brand === undefined ? this.#objectShapeOf(type) : this.shapeOf(brand)
    }
    if (!hasAnyFlag({ type, flags: TypeFlags.Object })) {
      return this.#refuse(this.#checker.typeToString(type))
    }
    return this.#containerShapeOf(type)
  }

  #into(step: string, container: Type): TypeWalk {
    return new TypeWalk({
      checker: this.#checker,
      program: this.#program,
      path: `${this.#path}${step}`,
      within: [...this.#within, container.id],
    })
  }

  #refuse(found: string): never {
    throw new NotJsonError({ path: this.#path, found })
  }

  #isLibraryInterface(symbol: TsSymbol): boolean {
    if ((symbol.flags & SymbolFlags.Interface) === 0) return false
    return symbol.declarations.some((declaration) => {
      const file = this.#program.getSourceFile(declaration.path)
      return file !== undefined && this.#program.isSourceFileDefaultLibrary(file)
    })
  }

  // An optional field's shape, which leaves out the `undefined` its optionality adds.
  #presentShapeOf(type: Type): Shape {
    if (!isUnionType(type)) return this.shapeOf(type)
    const present = type
      .getTypes()
      .filter((member) => !hasAnyFlag({ type: member, flags: TypeFlags.Undefined }))
    return { kind: 'union', of: present.map((member) => this.shapeOf(member)) }
  }

  #fieldOf(container: Type, property: TsSymbol): Field {
    const optional = (property.flags & SymbolFlags.Optional) !== 0
    const inner = this.#into(`.${property.name}`, container)
    const type = this.#checker.getTypeOfSymbol(property)
    if (type === undefined) return inner.#refuse('a field TypeScript has no type for')
    return {
      name: property.name,
      shape: optional ? inner.#presentShapeOf(type) : inner.shapeOf(type),
      optional,
    }
  }

  #objectShapeOf(type: Type): Shape {
    const signatures = [SignatureKind.Call, SignatureKind.Construct].flatMap((kind) =>
      this.#checker.getSignaturesOfType(type, kind),
    )
    if (signatures.length > 0) this.#refuse('a function')
    const symbol = type.getSymbol()
    if (symbol !== undefined && (symbol.flags & SymbolFlags.Class) !== 0) {
      this.#refuse(`an instance of ${symbol.name}`)
    }
    if (symbol !== undefined && this.#isLibraryInterface(symbol)) this.#refuse(`a ${symbol.name}`)
    const [index] = this.#checker.getIndexInfosOfType(type)
    return {
      kind: 'object',
      fields: this.#checker
        .getPropertiesOfType(type)
        .map((property) => this.#fieldOf(type, property)),
      index: index === undefined ? undefined : this.#into('[key]', type).shapeOf(index.valueType),
    }
  }

  #itemsOf(type: Type): Item[] | undefined {
    if (!isTypeReference(type)) return undefined
    const target = type.getTarget()
    if (!isTupleType(target)) return undefined
    return this.#checker.getTypeArguments(type).map((element, position) => ({
      shape: this.#into(`[${position}]`, type).shapeOf(element),
      element: elementOf(target.elementFlags[position] ?? ElementFlags.Required),
    }))
  }

  #primitiveOf(type: Type): Shape | undefined {
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
    return refused === undefined ? undefined : this.#refuse(refused[1])
  }

  // An array, a tuple or an object: the shapes a type flagged `Object` can take.
  #containerShapeOf(type: Type): Shape {
    if (isTypeReference(type) && this.#checker.isArrayType(type)) {
      const [element] = this.#checker.getTypeArguments(type)
      if (element === undefined) return this.#refuse('an array of no element type')
      return { kind: 'array', of: this.#into('[]', type).shapeOf(element) }
    }
    const items = this.#itemsOf(type)
    return items === undefined ? this.#objectShapeOf(type) : { kind: 'tuple', items }
  }
}
