/**
 * Code generators for Claude Code's virtual state module, bundle entry, and `types/index.d.ts`
 * state contract.
 *
 * `claude plugin validate` tracks persistent state only through `atom()` calls with literal
 * `{ plugin, key }` descriptors inside the bundled hooks file. Each state atom stores
 * `{ value } | null` so a persisted `null` remains distinct from an unset atom.
 *
 * @module
 */

import { genAugmentation, genImport, genObjectFromValues, genString } from 'knitwork'
import { pascalCase } from 'scule'

import type { Shape, StateDecl } from '@atuin/modkit-target'

// Atom bumped on every render so Claude Code's `ui.render` hooks re-evaluate.
const VIEW_KEY = 'modkit.view'

const toolHook = ({ event, tool, hook }: { event: string; tool: string; hook: string }): string =>
  `  on(${genString(event)}, ${genObjectFromValues({ tool })}, ($, e, next) => runtime.${hook}(engineOf($), e, next)).catch(($, e, next) => next(e))`

const rowHook = (tool: string): string =>
  `  on("ui.render", ${genObjectFromValues({ component: 'ToolUse', props: { tool } })}, ($, e, next) => runtime.renderCards(engineOf($), e, next))`

export const entrySource = ({
  mod,
  runtime,
  tools,
}: {
  mod: string
  runtime: string
  tools: { before: readonly string[]; after: readonly string[]; cards: readonly string[] }
}): string =>
  [
    genImport(runtime, ['ClaudeCodeRuntime', 'engineOf', 'registerHooks']),
    genImport(mod, 'mod'),
    '',
    'export const register = (on, options) => {',
    '  const runtime = new ClaudeCodeRuntime({ mod, options })',
    '  registerHooks(on, runtime)',
    ...tools.before.map((tool) => toolHook({ event: 'tool.check', tool, hook: 'checkTool' })),
    ...tools.after.map((tool) => toolHook({ event: 'tool.call', tool, hook: 'callTool' })),
    ...tools.cards.map((tool) => rowHook(tool)),
    '}',
    '',
  ].join('\n')

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
 * The state a mod keeps, as the modules its Claude Code plugin is built with: the atoms that hold
 * it, and the contract `claude plugin validate` checks their keys against.
 */
export class StateModule {
  readonly #plugin: string
  readonly #state: readonly StateDecl[]

  constructor({ plugin, state }: { plugin: string; state: readonly StateDecl[] }) {
    this.#plugin = plugin
    this.#state = state
  }

  /**
   * The virtual `modkit-claude:state` module imported by the runtime adapter.
   *
   * Declares one `atom()` per state entry plus the view counter atom, and exports `plugin`, `load`,
   * `save`, `readView`, and `bumpView`.
   */
  source(): string {
    return [
      genImport('claude-code', ['atom', 'read', 'update']),
      '',
      `export const plugin = ${genString(this.#plugin)}`,
      '',
      `const view = atom(${genObjectFromValues({ plugin: this.#plugin, key: VIEW_KEY })}, 0)`,
      ...this.#atoms(),
      '',
      'export async function load($) {',
      '  const stored = new Map()',
      ...this.#loads(),
      '  return stored',
      '}',
      '',
      'export function save($, { key, stored }) {',
      '  switch (key) {',
      ...this.#saves(),
      '  }',
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- emitted source, interpolated where it runs
      '  return Promise.reject(new Error(`${key} has no atom: declare it with state() or query() where the build reads it`))',
      '}',
      '',
      'export function readView($) {',
      '  return read($, view)',
      '}',
      '',
      'export function bumpView($) {',
      '  return update($, view, (n) => n + 1)',
      '}',
      '',
    ].join('\n')
  }

  /**
   * `types/index.d.ts`, declaring the plugin's `PluginState` module augmentation.
   *
   * Exports one type alias per state slot (required so TypeScript treats the file as a module for
   * `declare module 'claude-code'`) and declares every atom key checked by `claude plugin validate`.
   * Recursive `self` references in a shape emit `unknown` because inline type literals cannot name
   * themselves.
   */
  contract(): string {
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

  #atoms(): string[] {
    return this.#state.map((one, index) => {
      const ref = genObjectFromValues({ plugin: this.#plugin, key: one.id })
      const options = genObjectFromValues({ shape: one.tag })
      return `const state${index} = atom(${ref}, null, ${options})`
    })
  }

  #loads(): string[] {
    return this.#state.map((one, index) => {
      const value = `value${index}`
      const stored = `{ value: ${value}.value }`
      return `  const ${value} = await read($, state${index})\n  if (${value} !== null) stored.set(${genString(one.id)}, ${stored})`
    })
  }

  #saves(): string[] {
    return this.#state.map(
      (one, index) =>
        `    case ${genString(one.id)}:\n      return update($, state${index}, () => ({ value: stored.value }))`,
    )
  }
}
