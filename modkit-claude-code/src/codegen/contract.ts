/**
 * Generator for Claude Code's `types/index.d.ts` `PluginState` module augmentation.
 *
 * @module
 */

import { genAugmentation, genString } from 'knitwork'
import { pascalCase } from 'scule'

import type {
  ArtifactEmitter,
  ArtifactWriter,
  Shape,
  SourceEmitter,
  StateDecl,
} from '@atuin/modkit-target'

import { VIEW_KEY } from './state.ts'

function typeOf(shape: Shape): string {
  switch (shape.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return shape.kind
    case 'literal':
      return typeof shape.value === 'string' ? genString(shape.value) : String(shape.value)
    case 'array':
      return `readonly (${typeOf(shape.of)})[]`
    case 'tuple':
      return `readonly [${shape.items
        .map((item) => {
          const type = typeOf(item.shape)
          if (item.element === 'rest') return `...(${type})[]`
          return item.element === 'optional' ? `(${type})?` : type
        })
        .join(', ')}]`
    case 'object': {
      const fields = shape.fields.map(
        (field) =>
          `readonly ${genString(field.name)}${field.optional ? '?' : ''}: ${typeOf(field.shape)}`,
      )
      const index =
        shape.index === undefined ? [] : [`readonly [key: string]: ${typeOf(shape.index)}`]
      return `{ ${[...fields, ...index].join('; ')} }`
    }
    case 'union':
      return shape.of.map((member) => `(${typeOf(member)})`).join(' | ')
    case 'self':
      break
  }
  return 'unknown'
}

function heldType(one: StateDecl): string {
  const value = typeOf(one.shape)
  return one.kind === 'query'
    ? `{ readonly input: string; readonly at: number; readonly value?: ${value} }`
    : value
}

/**
 * `types/index.d.ts` emitter declaring the plugin's `PluginState` module augmentation.
 *
 * Exports one type alias per state slot (required so TypeScript treats the file as a module for
 * `declare module 'claude-code'`) and declares every atom key checked by `claude plugin validate`.
 * Recursive `self` references in a shape emit `unknown` because inline type literals cannot name
 * themselves.
 */
export class StateContract implements SourceEmitter, ArtifactEmitter {
  readonly #plugin: string
  readonly #state: readonly StateDecl[]

  constructor({ plugin, state }: { plugin: string; state: readonly StateDecl[] }) {
    this.#plugin = plugin
    this.#state = state
  }

  emitSource(): string {
    const types = this.#state.map((one) => `export type ${pascalCase(one.id)} = ${heldType(one)}`)
    const entries = Object.fromEntries([
      [VIEW_KEY, 'number'],
      ...this.#state.map(
        (one) => [one.id, `Shaped<{ readonly value: ${pascalCase(one.id)} } | null>`] as const,
      ),
    ])
    return [
      '// The state contract modkit wrote for this mod: build it again rather than edit it.',
      ...types,
      '',
      genAugmentation('claude-code', { PluginState: { [this.#plugin]: entries } }),
      '',
    ].join('\n')
  }

  emitTo(emit: ArtifactWriter): void {
    emit.text('types/index.d.ts', this)
  }
}
