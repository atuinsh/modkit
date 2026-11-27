/**
 * The paths an `<Img>`'s `image` can be, read from its attributes as JSX applies them: in order,
 * each one over those before it.
 *
 * An `image` attribute names its paths with a string literal, or an expression whose type is one or
 * a union of them. A `{...spread}` can set `image` too: one whose type always holds an `image`
 * replaces the paths so far, and one whose `image` is optional adds to them. An attribute or spread
 * whose `image` the build can't read, such as a `string`, an `any` or an index signature, leaves the
 * paths unknown until a later one always sets `image` over it; still unknown after the last, it
 * fails the build, since it could draw a PNG the build never embedded.
 *
 * @module
 */

import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import {
  hasAnyFlag,
  isStringLiteralType,
  isUnionType,
  SymbolFlags,
  syntax,
  TypeFlags,
  type Node,
  type Project,
  type TsSymbol,
  type Type,
} from './program.ts'

/** Each path an `<Img>` can draw, by the attribute or spread that names it. */
export type NamedPaths = ReadonlyMap<string, Node>

interface Named {
  paths: ReadonlyMap<string, Node>
  /** Whether an attribute so far always sets `image`, rather than only maybe. */
  isSet: boolean
}

const UNSET: Named = { paths: new Map(), isSet: false }

// The paths so far, or the diagnostic naming the attribute that left them unknown.
type Read = Named | Diagnostic

const isUnknown = (read: Read): read is Diagnostic => 'code' in read

// What a spread sets `image` to: the paths it can set, and whether it always sets one.
interface SpreadImage {
  paths: readonly string[]
  isSet: boolean
}

const SETS_NOTHING: SpreadImage = { paths: [], isSet: false }

const LITERAL_MESSAGE =
  "<Img> names its image with a string literal, or a union of them: the build embeds each PNG a mod's <Img>s name"

const SPREAD_MESSAGE =
  "this spread can set <Img>'s image to a path the build can't know: type its image as a string literal, or a union of them"

const isImageAttribute = (node: Node): node is syntax.JsxAttribute =>
  syntax.isJsxAttribute(node) && syntax.isIdentifier(node.name) && node.name.text === 'image'

// The strings `type` can be, when it is a string literal or a union of them.
function literalsOf(type: Type): string[] | undefined {
  const members = isUnionType(type) ? type.getTypes() : [type]
  const texts = members.flatMap((member) => (isStringLiteralType(member) ? [member.value] : []))
  return texts.length === members.length ? texts : undefined
}

// The paths an `image` attribute's value can be, when the build can know them.
function writtenPathsOf({
  project,
  attribute,
}: {
  project: Project
  attribute: syntax.JsxAttribute
}): string[] | undefined {
  const value = attribute.initializer
  const written = value !== undefined && syntax.isJsxExpression(value) ? value.expression : value
  if (written === undefined) return undefined
  // The checker widens a JSX attribute's string to `string`, but not an expression's literal type.
  if (syntax.isStringLiteral(written)) return [written.text]
  const type = project.checker.getTypeAtLocation(written)
  return type === undefined ? undefined : literalsOf(type)
}

// Whether a spread copies `image`. It copies own enumerable properties alone: a getter written in an
// object literal is one, while a class's getter sits on its prototype, and one only declared in a
// type may be either, so neither of those may set anything though the checker says it always does.
function isCopied(image: TsSymbol): boolean {
  if ((image.flags & SymbolFlags.Accessor) === 0) return true
  return image.declarations.every((declaration) => {
    const node = declaration.resolve()
    return node !== undefined && syntax.isObjectLiteralExpression(node.parent)
  })
}

// What spreading a value of `type`, which is no union, sets `image` to, or undefined when the
// build can't tell.
function memberImageOf({
  project,
  type,
}: {
  project: Project
  type: Type
}): SpreadImage | undefined {
  const { checker } = project
  const isOpaque =
    hasAnyFlag({ type, flags: TypeFlags.Any | TypeFlags.Unknown }) ||
    checker.getIndexInfosOfType(type).length > 0
  if (isOpaque) return undefined
  const image = checker.getPropertyOfType(type, 'image')
  if (image === undefined) return SETS_NOTHING
  const declared = checker.getTypeOfSymbol(image)
  const present = declared === undefined ? undefined : checker.getNonNullableType(declared)
  // An `image?: undefined`, as a normalized `cond ? { image } : {}` has, sets nothing.
  if (present !== undefined && hasAnyFlag({ type: present, flags: TypeFlags.Never })) {
    return SETS_NOTHING
  }
  const paths = present === undefined ? undefined : literalsOf(present)
  if (paths === undefined) return undefined
  return { paths, isSet: (image.flags & SymbolFlags.Optional) === 0 && isCopied(image) }
}

// What spreading `spread` sets `image` to, over each member of its type when that is a union.
function spreadImageOf({
  project,
  spread,
}: {
  project: Project
  spread: syntax.JsxSpreadAttribute
}): SpreadImage | undefined {
  const type = project.checker.getTypeAtLocation(spread.expression)
  if (type === undefined) return undefined
  const members = (isUnionType(type) ? type.getTypes() : [type]).map((member) =>
    memberImageOf({ project, type: member }),
  )
  const read = members.flatMap((member) => (member === undefined ? [] : [member]))
  if (read.length < members.length) return undefined
  return {
    paths: [...new Set(read.flatMap((member) => member.paths))],
    isSet: read.every((member) => member.isSet),
  }
}

// `read` once `spread`, the next of an `<Img>`'s attributes, applies over it.
function spreadOver({
  project,
  spread,
  read,
}: {
  project: Project
  spread: syntax.JsxSpreadAttribute
  read: Read
}): Read {
  const image = spreadImageOf({ project, spread })
  if (image === undefined) {
    return diagnosticAt({ code: 'image', message: SPREAD_MESSAGE, node: spread })
  }
  const set = image.paths.map((path): [string, Node] => [path, spread])
  if (image.isSet) return { paths: new Map(set), isSet: true }
  // A spread that only may set `image` leaves one the build can't know as unknown as it was.
  if (isUnknown(read)) return read
  return { paths: new Map([...read.paths, ...set]), isSet: read.isSet }
}

// `read` once `property`, the next of an `<Img>`'s attributes, applies over it.
function appliedOf({
  project,
  property,
  read,
}: {
  project: Project
  property: Node
  read: Read
}): Read {
  if (syntax.isJsxSpreadAttribute(property)) return spreadOver({ project, spread: property, read })
  if (!isImageAttribute(property)) return read
  const paths = writtenPathsOf({ project, attribute: property })
  if (paths === undefined) {
    return diagnosticAt({ code: 'image', message: LITERAL_MESSAGE, node: property })
  }
  const at = property.initializer ?? property
  return { paths: new Map(paths.map((path) => [path, at])), isSet: true }
}

/** The paths `element`'s `image` can be, by what names each, or why the build can't know them. */
export function pathsOf({
  project,
  element,
}: {
  project: Project
  element: syntax.JsxSelfClosingElement | syntax.JsxOpeningElement
}): NamedPaths | Diagnostic {
  let read: Read = UNSET
  for (const property of element.attributes.properties) {
    read = appliedOf({ project, property, read })
  }
  if (isUnknown(read)) return read
  if (read.isSet) return read.paths
  return diagnosticAt({ code: 'image', message: LITERAL_MESSAGE, node: element })
}
