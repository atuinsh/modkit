import type { ToolRendererResolver, ToolRenderers } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { isPlainObject } from 'es-toolkit/predicate'

import type { ToolRow, UiNode } from '@atuin/modkit-target/host'

import { modToolOf } from './hooks'
import { linesOf } from './lines'
import { paintOf } from './paint'

const ROWS_REDRAWN = 200

export class Cards {
  readonly #tools: readonly string[]
  readonly #cards: (row: ToolRow) => readonly UiNode[]
  readonly #rows = new Map<string, () => void>()

  constructor({
    tools,
    cards,
  }: {
    tools: readonly string[]
    cards: (row: ToolRow) => readonly UiNode[]
  }) {
    this.#tools = tools
    this.#cards = cards
  }

  get resolver(): ToolRendererResolver {
    return (tool, next) => this.#renderers({ tool, next })
  }

  redraw(): void {
    for (const redraw of this.#rows.values()) redraw()
  }

  forget(): void {
    this.#rows.clear()
  }

  #renderers({
    tool,
    next,
  }: {
    tool: string
    next: () => ToolRenderers | undefined
  }): ToolRenderers | undefined {
    const base = next()
    const name = modToolOf(tool)
    if (base === undefined || !this.#tools.includes(name)) return base
    const own = base.renderResult
    return {
      ...base,
      // oxlint-disable-next-line eslint/max-params -- pi calls a renderer with these four
      renderResult: (result, options, theme, context): Component => {
        const drawn = own?.(result, options, theme, context)
        this.#keep({ id: context.toolCallId, redraw: context.invalidate })
        const row = {
          id: context.toolCallId,
          tool: name,
          input: isPlainObject(context.args) ? context.args : {},
          isRunning: options.isPartial,
          failed: context.isError,
        }
        return {
          render: (width) => {
            const cards = this.#cards(row)
            const under = linesOf({
              nodes: cards,
              width,
              paint: paintOf({ theme, hasKeys: false, isLine: false, drawsImages: true }),
            })
            return [...(drawn?.render(width) ?? []), ...under]
          },
          invalidate: () => {
            drawn?.invalidate()
          },
        }
      },
    }
  }

  #keep({ id, redraw }: { id: string; redraw: () => void }): void {
    this.#rows.delete(id)
    this.#rows.set(id, redraw)
    const oldest = this.#rows.keys().next()
    if (this.#rows.size > ROWS_REDRAWN && oldest.done !== true) this.#rows.delete(oldest.value)
  }
}
