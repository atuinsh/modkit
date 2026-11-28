import * as v from 'valibot'

import type { UiNode } from '../ui/node'
import type { RenderScope } from './frame'

/** Any value a mod component can return: an element, primitive, ignored value, or nested array. */
export type ModNode = ModElement | string | number | boolean | null | undefined | readonly ModNode[]

export type Tag = (props: never) => ModNode

/** Type-erased component function invoked by the renderer after JSX checks props. */
export type Renderable = (props: Readonly<Record<string, unknown>>) => unknown

/** A single JSX element produced by the JSX runtime and walked by the renderer. */
export interface ModElement {
  readonly type: Renderable
  readonly props: Readonly<Record<string, unknown>>
  readonly key: string | undefined
}

export type Component<P> = (props: P) => ModNode

interface Drawn<Props> {
  props: Props
  key: string | undefined
  children: UiNode[]
  scope: RenderScope
}

type Kind = Exclude<UiNode, string>['kind']

type NodeOf<K extends Kind> = Extract<UiNode, { kind: K }>

type TextOf = (nodes: readonly UiNode[]) => string

export interface Primitive<Props = unknown, K extends Kind = Kind> {
  readonly name: K
  readonly schema: v.GenericSchema<unknown, Props>
  readonly node: (drawn: Drawn<Props>) => NodeOf<K>
  readonly text: (written: { node: NodeOf<K>; textOf: TextOf }) => string
}

const PRIMITIVES = new WeakMap<Renderable, Primitive>()
const BY_KIND = new Map<Kind, Primitive>()
const MARKERS = new WeakMap<Renderable, string>()

const unrendered = (name: string) => (): ModNode => {
  throw new Error(`<${name}> is read by modkit's render, never called`)
}

export function primitive<P, Props, K extends Kind>(definition: Primitive<Props, K>): Component<P> {
  const tag = unrendered(definition.name)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/consistent-type-assertions -- render hands a definition the props its schema parsed, and textOf the node of its kind
  const erased = definition as unknown as Primitive
  PRIMITIVES.set(tag, erased)
  BY_KIND.set(definition.name, erased)
  return tag
}

export function marker<P>(name: string): Component<P> {
  const tag = unrendered(name)
  MARKERS.set(tag, name)
  return tag
}

export const primitiveOf = (type: Renderable): Primitive | undefined => PRIMITIVES.get(type)

export const isTag = ({ element, tag }: { element: ModElement; tag: Tag }): boolean => {
  // `Tag` and `Renderable` share no type for `===` to compare them in.
  const renderable: unknown = tag
  return element.type === renderable
}

export const nameOf = (element: ModElement): string =>
  primitiveOf(element.type)?.name ??
  MARKERS.get(element.type) ??
  (element.type.name === '' ? 'Anonymous' : element.type.name)

/** Group child nodes without adding a wrapper element. */
export const Fragment: Component<{ children?: ModNode }> = marker('Fragment')

/**
 * Flatten resolved UI `nodes` into plain text for text-only surfaces.
 *
 * `Column` children join with `gap + 1` newlines, `Row` children join with `max(1, gap)` spaces,
 * `Button` nodes render as `[hotkey] label` when a hotkey is set, and `Img` nodes as their fallback.
 */
export function textOf(nodes: readonly UiNode[]): string {
  return nodes
    .map((node) => {
      if (typeof node === 'string') return node
      const written = BY_KIND.get(node.kind)
      if (written === undefined) throw new Error(`no primitive draws a ${node.kind} node`)
      return written.text({ node, textOf })
    })
    .join('')
}

/** Check whether `value` is a {@link ModElement} produced by the JSX runtime. */
const ElementSchema = v.object({ type: v.function(), props: v.record(v.string(), v.unknown()) })

export const isElement = (value: unknown): value is ModElement => v.is(ElementSchema, value)
