import { splitByCase, upperFirst } from 'scule'

import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import type { ModCall } from './entry.ts'
import type { OptionDecl, OptionKind } from './ir.ts'
import {
  isNumberLiteralType,
  isStringLiteralType,
  isBooleanLiteralType,
  isTupleType,
  isTypeReference,
  syntax,
  type Node,
  type Project,
  type TsSymbol,
} from './program.ts'
import { canonical, type Field, type Shape } from './shape.ts'
import { shapeOf } from './types.ts'

const SETTING_KINDS = 'a string, a number, a boolean, one of a few strings, or a list of strings'

function kindOf(shape: Shape): OptionKind | undefined {
  switch (shape.kind) {
    case 'string':
    case 'number':
    case 'boolean':
      return { kind: shape.kind }
    case 'array':
      return shape.of.kind === 'string' ? { kind: 'strings' } : undefined
    case 'union': {
      const choices = shape.of.flatMap((member) =>
        member.kind === 'literal' && typeof member.value === 'string' ? [member.value] : [],
      )
      return choices.length === shape.of.length ? { kind: 'string', choices } : undefined
    }
    case 'null':
    case 'literal':
    case 'tuple':
    case 'object':
    case 'self':
      break
  }
  return undefined
}

type Literal = string | number | boolean | readonly string[]

function literalOf({ project, node }: { project: Project; node: Node }): Literal | undefined {
  if (syntax.isArrayLiteralExpression(node)) {
    const items = node.elements.map((element) => literalOf({ project, node: element }))
    return items.every((item) => typeof item === 'string') ? items : undefined
  }
  const type = project.checker.getTypeAtLocation(node)
  if (type === undefined) return undefined
  if (isStringLiteralType(type) || isNumberLiteralType(type) || isBooleanLiteralType(type)) {
    return type.value
  }
  if (!isTypeReference(type) || !isTupleType(type.getTarget())) return undefined
  const items = project.checker
    .getTypeArguments(type)
    .map((item) => (isStringLiteralType(item) ? item.value : undefined))
  return items.every((item) => typeof item === 'string') ? items : undefined
}

function defaulted({ kind, value }: { kind: OptionKind; value: Literal }): OptionKind | undefined {
  switch (kind.kind) {
    case 'string':
      if (typeof value !== 'string') break
      return kind.choices === undefined || kind.choices.includes(value)
        ? { ...kind, default: value }
        : undefined
    case 'strings':
      return Array.isArray(value) ? { kind: 'strings', default: value } : undefined
    case 'number':
      return typeof value === 'number' ? { kind: 'number', default: value } : undefined
    case 'boolean':
      return typeof value === 'boolean' ? { kind: 'boolean', default: value } : undefined
  }
  return undefined
}

function defaultedBy({
  project,
  kind,
  initializer,
}: {
  project: Project
  kind: OptionKind
  initializer: Node
}): OptionKind | undefined {
  const value = literalOf({ project, node: initializer })
  return value === undefined ? undefined : defaulted({ kind, value })
}

function titleOf(name: string): string {
  return splitByCase(name)
    .map((word, index) => {
      if (word === word.toUpperCase()) return word
      const lower = word.toLowerCase()
      return index === 0 ? upperFirst(lower) : lower
    })
    .join(' ')
}

function defaultsOf(parameter: Node | undefined): Map<string, Node> {
  if (parameter === undefined || !syntax.isParameterDeclaration(parameter)) return new Map()
  const { name } = parameter
  if (!syntax.isObjectBindingPattern(name)) return new Map()
  return new Map(
    name.elements.flatMap((element) => {
      const key = element.propertyName ?? element.name
      if (element.initializer === undefined || element.dotDotDotToken !== undefined) return []
      if (key === undefined || !syntax.isIdentifier(key)) return []
      return [[key.text, element.initializer] as const]
    }),
  )
}

interface Read {
  options: OptionDecl[]
  diagnostics: Diagnostic[]
}

interface PropContext {
  project: Project
  property: TsSymbol | undefined
  field: Field
  defaults: ReadonlyMap<string, Node>
  fallback: Node
}

const whereOf = ({ property, fallback }: Pick<PropContext, 'property' | 'fallback'>): Node =>
  property?.valueDeclaration?.resolve() ?? fallback

const cantBe = ({ name, holds }: { name: string; holds?: string }): string =>
  `${name} can't be a setting${holds === undefined ? '' : `, as it holds ${holds}`}: a setting holds ${SETTING_KINDS}`

function optionOf(context: PropContext): OptionDecl | Diagnostic {
  const { project, property, field, defaults } = context
  const { name } = field
  const at = whereOf(context)
  const kind = kindOf(field.shape)
  if (kind === undefined) {
    return diagnosticAt({ code: 'option-type', message: cantBe({ name }), node: at })
  }
  const description =
    property === undefined ? '' : project.checker.getDocumentationCommentOfSymbol(property).trim()
  if (description === '') {
    const message = `${name} has no doc comment, which Claude Code shows as the setting's description`
    return diagnosticAt({ code: 'option-no-description', message, node: at })
  }
  const initializer = defaults.get(name)
  const held = initializer === undefined ? kind : defaultedBy({ project, kind, initializer })
  if (held === undefined) {
    const message = `${name}'s default is written into plugin.json, so it's a literal or a const holding one`
    return diagnosticAt({ code: 'option-default', message, node: initializer ?? at })
  }
  const tags = property === undefined ? [] : project.checker.getJsDocTagsOfSymbol(property)
  const title = tags.find((tag) => tag.name === 'title')?.text?.trim()
  return {
    ...held,
    name,
    title: title === undefined || title === '' ? titleOf(name) : title,
    description,
    isRequired: !field.optional && initializer === undefined,
    isSensitive: tags.some((tag) => tag.name === 'sensitive'),
  }
}

const fail = ({ message, node }: { message: string; node: Node }): Read => ({
  options: [],
  diagnostics: [diagnosticAt({ code: 'option-type', message, node })],
})

const isDiagnostic = (value: OptionDecl | Diagnostic): value is Diagnostic => 'code' in value
const isOption = (value: OptionDecl | Diagnostic): value is OptionDecl => !isDiagnostic(value)

export function optionsIn({ project, mod }: { project: Project; mod: ModCall }): Read {
  const [settings] = mod.setup.parameters
  if (settings === undefined) return { options: [], diagnostics: [] }
  const { checker, program } = project
  const fallback: Node = settings
  const type = checker.getTypeAtLocation(settings)
  if (type === undefined) return { options: [], diagnostics: [] }
  const propertyNamed = (name: string): TsSymbol | undefined =>
    checker.getPropertiesOfType(type).find((property) => property.name === name)
  const shaped = shapeOf({ checker, program, type })
  if (!shaped.isJson) {
    const name = /^\.(?<name>[^.[]+)/u.exec(shaped.notJson.path)?.groups?.['name']
    const property = name === undefined ? undefined : propertyNamed(name)
    const message = cantBe({ name: name ?? "the mod's settings", holds: shaped.notJson.found })
    return fail({ message, node: whereOf({ property, fallback }) })
  }
  const shape = canonical(shaped.shape)
  if (shape.kind !== 'object' || shape.index !== undefined) {
    const message = "the mod's settings are each one named, so they have no index signature"
    return fail({ message, node: fallback })
  }
  const defaults = defaultsOf(settings)
  const fields = new Map(shape.fields.map((field) => [field.name, field]))
  // In the order the props are written, which is the order the config menu lists them in.
  const read = checker.getPropertiesOfType(type).flatMap((property) => {
    const field = fields.get(property.name)
    return field === undefined ? [] : [optionOf({ project, property, field, defaults, fallback })]
  })
  return {
    options: read.filter((one) => isOption(one)),
    diagnostics: read.filter((one) => isDiagnostic(one)),
  }
}
