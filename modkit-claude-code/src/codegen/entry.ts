/**
 * Generator for the virtual Claude Code bundle entry module registering mod hooks.
 *
 * @module
 */

import { genImport, genObjectFromValues, genString } from 'knitwork'

import { ImageBundle, type ImageDecl, type VirtualModule } from '@atuin/modkit-target'

const toolHook = ({ event, tool, hook }: { event: string; tool: string; hook: string }): string =>
  `  on(${genString(event)}, ${genObjectFromValues({ tool })}, ($, e, next) => runtime.${hook}(engineOf($), e, next)).catch(($, e, next) => next(e))`

const rowHook = (tool: string): string =>
  `  on("ui.render", ${genObjectFromValues({ component: 'ToolUse', props: { tool } })}, ($, e, next) => runtime.renderCards(engineOf($), e, next))`

/** Virtual entry module registering a compiled mod's hooks with Claude Code. */
export class ClaudeEntryModule implements VirtualModule {
  readonly id = '\0modkit-claude-entry'
  readonly #mod: string
  readonly #runtime: string
  readonly #tools: {
    readonly before: readonly string[]
    readonly after: readonly string[]
    readonly cards: readonly string[]
  }
  readonly #images: readonly ImageDecl[]

  constructor({
    mod,
    runtime,
    tools,
    images,
  }: {
    mod: string
    runtime: string
    tools: {
      readonly before: readonly string[]
      readonly after: readonly string[]
      readonly cards: readonly string[]
    }
    images: readonly ImageDecl[]
  }) {
    this.#mod = mod
    this.#runtime = runtime
    this.#tools = tools
    this.#images = images
  }

  emitSource(): string {
    return [
      genImport(this.#runtime, ['ClaudeCodeRuntime', 'engineOf', 'registerHooks']),
      genImport(this.#mod, 'mod'),
      '',
      `const images = ${new ImageBundle(this.#images).emitSource()}`,
      '',
      'export const register = (on, options) => {',
      '  const runtime = new ClaudeCodeRuntime({ mod, options, images })',
      '  registerHooks(on, runtime)',
      ...this.#tools.before.map((tool) =>
        toolHook({ event: 'tool.check', tool, hook: 'checkTool' }),
      ),
      ...this.#tools.after.map((tool) => toolHook({ event: 'tool.call', tool, hook: 'callTool' })),
      ...this.#tools.cards.map((tool) => rowHook(tool)),
      '}',
      '',
    ].join('\n')
  }
}
