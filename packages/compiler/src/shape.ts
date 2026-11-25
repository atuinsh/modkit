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

function canonicalUnion(members: readonly Shape[]): Shape {
  const flat = members
    .map((member) => canonical(member))
    .flatMap((member) => (member.kind === 'union' ? member.of : [member]))
  const hasBoth =
    flat.some((one) => isLiteral(one, true)) && flat.some((one) => isLiteral(one, false))
  const merged = hasBoth
    ? [
        ...flat.filter((one) => !isLiteral(one, true) && !isLiteral(one, false)),
        { kind: 'boolean' as const },
      ]
    : flat
  const unique = [...new Map(merged.map((one) => [keyOf(one), one])).entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([, one]) => one)
  const [only, ...rest] = unique
  if (only === undefined) throw new Error('a union has no members')
  return rest.length === 0 ? only : { kind: 'union', of: unique }
}

/**
 * Normalize `shape` into a deterministic canonical form.
 *
 * Sorts object fields by name, flattens nested unions, folds `true | false` into `boolean`,
 * deduplicates and sorts union members, and unwraps single-member unions.
 */
export function canonical(shape: Shape): Shape {
  switch (shape.kind) {
    case 'array':
      return { kind: 'array', of: canonical(shape.of) }
    case 'tuple':
      return {
        kind: 'tuple',
        items: shape.items.map((item) => ({ ...item, shape: canonical(item.shape) })),
      }
    case 'object':
      return {
        kind: 'object',
        fields: shape.fields
          .map((field) => ({ ...field, shape: canonical(field.shape) }))
          .toSorted((a, b) => (a.name < b.name ? -1 : Number(a.name > b.name))),
        index: shape.index === undefined ? undefined : canonical(shape.index),
      }
    case 'union':
      return canonicalUnion(shape.of)
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

// 12 base64url chars = 72 bits of SHA-256, keeping persisted shape tags compact and collision-free.
const TAG_LENGTH = 12

/** Compute the 12-char base64url SHA-256 shape tag (e.g. `zU5YcwUJx-Yh`) of `shape`. */
export const tagOf = (shape: Shape): string =>
  createHash('sha256')
    .update(keyOf(canonical(shape)))
    .digest('base64url')
    .slice(0, TAG_LENGTH)
