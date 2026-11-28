import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
  ToolResultEventResult,
} from '@earendil-works/pi-coding-agent'

import { NodeTargetRuntime } from '@atuin/modkit-target-node/runtime/node-runtime'
import type { Servers } from '@atuin/modkit-target-node/runtime/servers'
import type { Tags } from '@atuin/modkit-target-node/runtime/store'
import {
  ModVerdict,
  type CommandHost,
  type CommandView,
  type Failure,
  type HarnessAdapter,
  type Images,
  type Mod,
  type Options,
  type PaneHost,
  type ToolRow,
  type UiNode,
  type ViewHost,
} from '@atuin/modkit-target/host'

import { createSessionResources } from './harness'
import { callOf, followedBy, resultOf, type Block, type PiCall } from './hooks'
import { linesOf } from './lines'
import { Overlays } from './overlays'
import { paintOf } from './paint'

const STATUS_COLUMNS = 400

export interface Session {
  mod: Mod<Options>
  options: Options
  images: Images
  pi: ExtensionAPI
  plugin: string
  dir: string
  state: Tags
  registerCommand: (command: CommandView) => void
  redrawCards: () => void
}

export class PiRuntime extends NodeTargetRuntime<ExtensionContext> {
  readonly #pi: ExtensionAPI
  readonly #plugin: string
  readonly #dir: string
  readonly #state: Tags
  readonly #registerCommand: (command: CommandView) => void
  readonly #redrawCards: () => void
  readonly #overlays: Overlays
  #servers: Servers | undefined = undefined
  #report: ((failure: Failure) => void) | undefined = undefined
  #statuses = 0
  #isStopped = false

  protected override readonly panes: PaneHost<ExtensionContext> = {
    open: (ctx, { id, title, focus }) => {
      if (ctx.mode !== 'tui') {
        return { isPlaced: false, reason: 'pi shows panes in its terminal UI' }
      }
      this.#overlays.show({ ctx, id: id.toString(), title, body: this.paneBody(id) ?? [], focus })
      return { isPlaced: true }
    },
    close: (_ctx, id) => {
      this.#overlays.forget(id.toString())
    },
    isShown: (_ctx, id) => this.#overlays.has(id.toString()),
  }

  protected override readonly commands: CommandHost<ExtensionContext> = {
    register: (_ctx, command) => {
      this.#registerCommand(command)
    },
  }

  protected override readonly view: ViewHost<ExtensionContext> = {
    redraw: (ctx) => {
      if (this.#isStopped) return
      this.#drawStatuses(ctx, this.statuses())
      this.#overlays.redraw((id) => this.paneBody(id))
      this.#redrawCards()
    },
  }

  constructor(session: Session) {
    const { mod, options, images, pi, plugin, dir, state, registerCommand, redrawCards } = session
    super({ mod, options, images })
    this.#pi = pi
    this.#plugin = plugin
    this.#dir = dir
    this.#state = state
    this.#registerCommand = registerCommand
    this.#redrawCards = redrawCards
    this.#overlays = new Overlays({
      press: ({ ctx, button }) => {
        this.press(ctx, { button, surface: 'terminal' })
      },
      dismiss: (id) => {
        void this.dismiss(id)
      },
      report: (failure) => {
        this.#report?.(failure)
      },
    })
  }

  async startSession(ctx: ExtensionContext): Promise<void> {
    return this.start(ctx)
  }

  stop(ctx: ExtensionContext): void {
    this.#isStopped = true
    this[Symbol.dispose]()
    this.#overlays.stop()
    this.#drawStatuses(ctx, [])
    this.#servers?.[Symbol.dispose]()
  }

  endTurn(): void {
    this.turnEnded()
  }

  cardsUnder(row: ToolRow): readonly UiNode[] {
    return this.cards(row)
  }

  toggleFocus(): void {
    this.#overlays.toggleFocus()
  }

  async beforeCall(event: PiCall, ctx: ExtensionContext): Promise<Block | undefined> {
    try {
      const verdict = ModVerdict.from(await this.verdictFor(callOf({ event, cwd: ctx.cwd })))
      const outcome = await verdict.resolve({
        canAsk: ctx.hasUI,
        confirm: async (ask) => ctx.ui.confirm(`${this.#plugin} asks`, ask),
      })
      if (!outcome.allow) return { block: true, reason: outcome.reason }
      if (outcome.note !== undefined && ctx.hasUI) ctx.ui.notify(outcome.note, 'info')
      return undefined
    } catch {
      return undefined
    }
  }

  async afterCall(
    event: ToolResultEvent,
    ctx: ExtensionContext,
  ): Promise<ToolResultEventResult | undefined> {
    try {
      const result = resultOf({ event, cwd: ctx.cwd })
      if (result === undefined) return undefined
      const followup = await this.followupFor(result)
      if (followup.note !== undefined && ctx.hasUI) ctx.ui.notify(followup.note, 'info')
      return followedBy({ event, followup })
    } catch {
      return undefined
    }
  }

  async run(name: string, ctx: ExtensionContext): Promise<string | undefined> {
    return this.answerCommand(ctx, name)
  }

  protected override adapter(ctx: ExtensionContext): HarnessAdapter {
    const { harness, servers, report } = createSessionResources({
      pi: this.#pi,
      ctx,
      plugin: this.#plugin,
      dir: this.#dir,
      state: this.#state,
      isStopped: () => this.#isStopped,
    })
    this.#servers = servers
    this.#report = report
    return harness
  }

  #statusKey(index: number): string {
    return `${this.#plugin}.${index}`
  }

  #drawStatuses(ctx: ExtensionContext, statuses: readonly (readonly UiNode[])[]): void {
    if (!ctx.hasUI) return
    // The footer pi draws takes a line of text, so a status draws each fallback.
    const paint = paintOf({ theme: ctx.ui.theme, hasKeys: false, drawsImages: false })
    for (const [index, status] of statuses.entries()) {
      const line = linesOf({ nodes: status, width: STATUS_COLUMNS, paint }).join(' ')
      ctx.ui.setStatus(this.#statusKey(index), line === '' ? undefined : line)
    }
    for (let index = statuses.length; index < this.#statuses; index += 1) {
      ctx.ui.setStatus(this.#statusKey(index), undefined)
    }
    this.#statuses = statuses.length
  }
}
