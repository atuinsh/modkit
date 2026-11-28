/**
 * Structural JSON type shapes, canonicalization, and content hashing.
 *
 * Two structurally identical TypeScript types normalize to the exact same canonical {@link Shape}
 * regardless of interface names, property order, or union member order. Renaming an interface
 * preserves its shape tag and persisted state, while changing a field's type produces a new tag
 * that invalidates stale values.
 *
 * Recursive types use a de Bruijn-style `{ kind: 'self', up }` pointer counting enclosing
 * containers, which remains invariant under field and union reordering.
 *
 * @module
 */

import { createHash } from 'node:crypto'

import canonicalize from 'canonicalize'

/** A single property within an object {@link Shape}. */
export interface Field {
  name: string
  shape: Shape
  optional: boolean
}

/** A single positional element within a tuple {@link Shape}. */
export interface Item {
  shape: Shape
  /** `'rest'` marks a trailing `...T[]` element. */
  element: 'required' | 'optional' | 'rest'
}

/** Structural representation of a JSON-compatible TypeScript type. */
export type Shape =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'array'; of: Shape }
  | { kind: 'tuple'; items: readonly Item[] }
  | { kind: 'object'; fields: readonly Field[]; index: Shape | undefined }
  | { kind: 'union'; of: readonly Shape[] }
  | { kind: 'self'; up: number }

const keyOf = (shape: Shape): string => canonicalize(shape) ?? ''

const isLiteral = (shape: Shape, value: boolean): boolean =>
  shape.kind === 'literal' && shape.value === value

// 12 base64url chars = 72 bits of SHA-256, keeping persisted shape tags compact and collision-free.
const TAG_LENGTH = 12

/** Bound wrapper around a structural JSON {@link Shape} supporting canonicalization and hashing. */
export class JsonShape {
  readonly #shape: Shape

  constructor(shape: Shape) {
    this.#shape = shape
  }

  /** Wrap `shape` for canonicalization or tag hashing. */
  static of(shape: Shape): JsonShape {
    return new JsonShape(shape)
  }

  /**
   * Normalize this shape into a deterministic canonical form.
   *
   * Sorts object fields by name, flattens nested unions, folds `true | false` into `boolean`,
   * deduplicates and sorts union members, and unwraps single-member unions.
   */
  canonical(): Shape {
    const shape = this.#shape
    switch (shape.kind) {
      case 'array':
        return { kind: 'array', of: JsonShape.of(shape.of).canonical() }
      case 'tuple':
        return {
          kind: 'tuple',
          items: shape.items.map((item) => ({
            ...item,
            shape: JsonShape.of(item.shape).canonical(),
          })),
        }
      case 'object':
        return {
          kind: 'object',
          fields: shape.fields
            .map((field) => ({ ...field, shape: JsonShape.of(field.shape).canonical() }))
            .toSorted((left, right) =>
              left.name < right.name ? -1 : Number(left.name > right.name),
            ),
          index: shape.index === undefined ? undefined : JsonShape.of(shape.index).canonical(),
        }
      case 'union':
        return JsonShape.#canonicalUnion(shape.of)
      case 'string':
      case 'number':
      case 'boolean':
      case 'null':
      case 'literal':
      case 'self':
        break
    }
    return shape
  }

  /** Compute the 12-char base64url SHA-256 shape tag (e.g. `zU5YcwUJx-Yh`) of this shape. */
  tag(): string {
    return createHash('sha256')
      .update(keyOf(this.canonical()))
      .digest('base64url')
      .slice(0, TAG_LENGTH)
  }

  static #canonicalUnion(members: readonly Shape[]): Shape {
    const flat = members
      .map((member) => JsonShape.of(member).canonical())
      .flatMap((member) => (member.kind === 'union' ? member.of : [member]))
    const hasBoth =
      flat.some((one) => isLiteral(one, true)) && flat.some((one) => isLiteral(one, false))
    const merged = hasBoth
      ? [
          ...flat.filter((one) => !isLiteral(one, true) && !isLiteral(one, false)),
          { kind: 'boolean' as const },
        ]
      : flat
    const unique = new Map(merged.map((one) => [keyOf(one), one]))
      .entries()
      .toArray()
      .toSorted(([left], [right]) => (left < right ? -1 : Number(left > right)))
      .map(([, one]) => one)
    const [only, ...rest] = unique
    if (only === undefined) throw new Error('a union has no members')
    return rest.length === 0 ? only : { kind: 'union', of: unique }
  }
}
