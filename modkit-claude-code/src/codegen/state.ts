/**
 * Code generator for Claude Code's virtual `modkit-claude:state` module.
 *
 * `claude plugin validate` tracks persistent state only through `atom()` calls with literal
 * `{ plugin, key }` descriptors inside the bundled hooks file. Each state atom stores
 * `{ value } | null` so a persisted `null` remains distinct from an unset atom.
 *
 * @module
 */

import { genImport, genObjectFromValues, genString } from 'knitwork'

import type { StateDecl, VirtualModule } from '@atuin/modkit-target'

/** Atom key bumped on every render so Claude Code's `ui.render` hooks re-evaluate. */
export const VIEW_KEY = 'modkit.view'

/**
 * Virtual `modkit-claude:state` module imported by the runtime adapter.
 *
 * Declares one `atom()` per state entry plus the view counter atom, and exports `plugin`, `load`,
 * `save`, `readView`, and `bumpView`.
 */
export class StateModule implements VirtualModule {
  readonly id = 'modkit-claude:state'
  readonly #plugin: string
  readonly #state: readonly StateDecl[]

  constructor({ plugin, state }: { plugin: string; state: readonly StateDecl[] }) {
    this.#plugin = plugin
    this.#state = state
  }

  emitSource(): string {
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
