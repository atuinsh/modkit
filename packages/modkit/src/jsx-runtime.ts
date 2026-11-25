/**
 * Automatic JSX runtime for mods configured with `"jsxImportSource": "@atuin/modkit"`.
 *
 * @module
 */

import type { ModElement, ModNode, Renderable, Tag } from './runtime/element'

export { Fragment } from './runtime/element'

/** Create a {@link ModElement} for a JSX tag expression. */
// oxlint-disable-next-line eslint/max-params -- the signature the automatic JSX runtime calls
export function jsx(
  type: Tag,
  props: Readonly<Record<string, unknown>>,
  key?: string | number,
): ModElement {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSX checked `props` against the tag's own props type
    type: type as unknown as Renderable,
    props,
    key: key === undefined ? undefined : String(key),
  }
}

export { jsx as jsxs, jsx as jsxDEV }

export declare namespace JSX {
  type Element = ModElement
  type ElementType = Tag
  interface ElementChildrenAttribute {
    children: unknown
  }
  interface IntrinsicAttributes {
    key?: string | number
  }
}

export type { ModNode }
