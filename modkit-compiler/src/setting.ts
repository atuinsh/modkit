import { splitByCase, upperFirst } from 'scule'

import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
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
import type { Field, Shape } from './shape.ts'

const SETTING_KINDS = 'a string, a number, a boolean, one of a few strings, or a list of strings'

/** Why `name` can't be a setting, naming what it `holds` when that is known. */
export const cantBe = ({ name, holds }: { name: string; holds?: string }): string =>
  `${name} can't be a setting${holds === undefined ? '' : `, as it holds ${holds}`}: a setting holds ${SETTING_KINDS}`

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

function titleOf(name: string): string {
  return splitByCase(name)
    .map((word, index) => {
      if (word === word.toUpperCase()) return word
      const lower = word.toLowerCase()
      return index === 0 ? upperFirst(lower) : lower
    })
    .join(' ')
}

/**
 * One prop of a mod's settings type, which the build turns into one of Claude Code's settings.
 *
 * Its doc comment is the setting's description, `@title` and `@sensitive` tag it, and the default
 * the settings parameter's destructuring gives it is written into plugin.json.
 */
export class Setting {
  readonly #project: Project
  readonly #property: TsSymbol | undefined
  readonly #field: Field
  // The default the settings parameter's destructuring gives the prop, if any.
  readonly #initializer: Node | undefined
  // Where a diagnostic points when the prop has no declaration of its own.
  readonly #fallback: Node

  constructor({
    project,
    property,
    field,
    initializer,
    fallback,
  }: {
    project: Project
    property: TsSymbol | undefined
    field: Field
    initializer: Node | undefined
    fallback: Node
  }) {
    this.#project = project
    this.#property = property
    this.#field = field
    this.#initializer = initializer
    this.#fallback = fallback
  }

  /** The option the prop declares, or the diagnostic saying why it can't be one. */
  option(): { isOk: true; option: OptionDecl } | { isOk: false; diagnostic: Diagnostic } {
    const { name } = this.#field
    const kind = kindOf(this.#field.shape)
    if (kind === undefined) {
      return {
        isOk: false,
        diagnostic: diagnosticAt({
          code: 'option-type',
          message: cantBe({ name }),
          node: this.#where(),
        }),
      }
    }
    const description = this.#description()
    if (description === '') {
      const message = `${name} has no doc comment, which harnesses show as the setting's description`
      return {
        isOk: false,
        diagnostic: diagnosticAt({ code: 'option-no-description', message, node: this.#where() }),
      }
    }
    const held = this.#defaulted(kind)
    if (held === undefined) {
      const message = `${name}'s default is written into the built manifest, so it's a literal or a const holding one`
      return {
        isOk: false,
        diagnostic: diagnosticAt({
          code: 'option-default',
          message,
          node: this.#initializer ?? this.#where(),
        }),
      }
    }
    const { title, isSensitive } = this.#tags()
    return {
      isOk: true,
      option: {
        ...held,
        name,
        title: title ?? titleOf(name),
        description,
        isRequired: !this.#field.optional && this.#initializer === undefined,
        isSensitive,
      },
    }
  }

  #where(): Node {
    return this.#property?.valueDeclaration?.resolve() ?? this.#fallback
  }

  #description(): string {
    const property = this.#property
    if (property === undefined) return ''
    return this.#project.checker.getDocumentationCommentOfSymbol(property).trim()
  }

  #tags(): { title: string | undefined; isSensitive: boolean } {
    const property = this.#property
    const tags = property === undefined ? [] : this.#project.checker.getJsDocTagsOfSymbol(property)
    const title = tags.find((tag) => tag.name === 'title')?.text?.trim()
    return {
      title: title === '' ? undefined : title,
      isSensitive: tags.some((tag) => tag.name === 'sensitive'),
    }
  }

  // `kind` with the prop's default, if it has one that is a literal of that kind.
  #defaulted(kind: OptionKind): OptionKind | undefined {
    if (this.#initializer === undefined) return kind
    const value = this.#literalOf(this.#initializer)
    return value === undefined ? undefined : defaulted({ kind, value })
  }

  #literalOf(node: Node): Literal | undefined {
    if (syntax.isArrayLiteralExpression(node)) {
      const items = node.elements.map((element) => this.#literalOf(element))
      return items.every((item) => typeof item === 'string') ? items : undefined
    }
    const type = this.#project.checker.getTypeAtLocation(node)
    if (type === undefined) return undefined
    if (isStringLiteralType(type) || isNumberLiteralType(type) || isBooleanLiteralType(type)) {
      return type.value
    }
    if (!isTypeReference(type) || !isTupleType(type.getTarget())) return undefined
    const items = this.#project.checker
      .getTypeArguments(type)
      .map((item) => (isStringLiteralType(item) ? item.value : undefined))
    return items.every((item) => typeof item === 'string') ? items : undefined
  }
}
