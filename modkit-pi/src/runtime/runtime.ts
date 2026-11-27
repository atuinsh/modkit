import { join } from 'node:path'

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
  ToolResultEventResult,
} from '@earendil-works/pi-coding-agent'

import { Servers } from '@atuin/modkit-target-node/runtime/servers'
import { fileStore, type Tags } from '@atuin/modkit-target-node/runtime/store'
import {
  failureReporter,
  ModkitTargetRuntime,
  resolveVerdict,
  type CommandView,
  type Failure,
  type HarnessAdapter,
  type Images,
  type Mod,
  type Options,
  type PaneOpened,
  type PaneOpening,
  type Repeat,
  type Store,
  type ToolRow,
  type UiNode,
} from '@atuin/modkit-target/host'

import { harnessFor } from './harness'
import { callOf, followedBy, resultOf, type Block, type PiCall } from './hooks'
import { linesOf } from './lines'
import { configuredServer } from './mcp'
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

export class PiRuntime extends ModkitTargetRuntime<ExtensionContext> {
  readonly #pi: ExtensionAPI
  readonly #plugin: string
  readonly #dir: string
  readonly #state: Tags
  readonly #registerCommand: (command: CommandView) => void
  readonly #redrawCards: () => void
  readonly #overlays: Overlays
  readonly #repeats: NodeJS.Timeout[] = []
  #servers: Servers | undefined = undefined
  #report: ((failure: Failure) => void) | undefined = undefined
  #statuses = 0
  #isStopped = false

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
    for (const repeat of this.#repeats) clearInterval(repeat)
    this.#overlays.stop()
    this.#drawStatuses(ctx, [])
    this.#servers?.close()
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
      const outcome = await resolveVerdict({
        verdict: await this.verdictFor(callOf({ event, cwd: ctx.cwd })),
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

  protected override async adapter(ctx: ExtensionContext): Promise<HarnessAdapter> {
    const plugin = this.#plugin
    const report = failureReporter({
      plugin,
      notify: (line) => {
        if (ctx.hasUI) ctx.ui.notify(line, 'error')
      },
    })
    this.#report = report
    const servers = new Servers({
      find: async (name) =>
        configuredServer({ name, cwd: ctx.cwd, isTrusted: ctx.isProjectTrusted() }),
    })
    this.#servers = servers
    const store = fileStore({
      dir: join(this.#dir, 'sessions'),
      session: ctx.sessionManager.getSessionId(),
      tags: this.#state,
      report,
    })
    // A query still fetching when the session stopped would write its stale state over what the
    // session's next runtime has saved since.
    const kept: Store = {
      get: (key) => store.get(key),
      set: (key, stored) => {
        if (!this.#isStopped) store.set(key, stored)
      },
    }
    return harnessFor({ pi: this.#pi, ctx, plugin, servers, store: kept, report })
  }

  protected override async redraw(ctx: ExtensionContext): Promise<unknown> {
    if (this.#isStopped) return undefined
    this.#drawStatuses(ctx, this.statuses())
    this.#overlays.redraw((id) => this.paneBody(id))
    this.#redrawCards()
    return undefined
  }

  protected override async openPane(
    ctx: ExtensionContext,
    { id, title, focus }: PaneOpening,
  ): Promise<PaneOpened> {
    if (ctx.mode !== 'tui') return { isPlaced: false, reason: 'pi shows panes in its terminal UI' }
    this.#overlays.show({ ctx, id, title, body: this.paneBody(id) ?? [], focus })
    return { isPlaced: true }
  }

  protected override async closePane(_ctx: ExtensionContext, id: string): Promise<unknown> {
    this.#overlays.forget(id)
    return undefined
  }

  protected override async isPaneShown(_ctx: ExtensionContext, id: string): Promise<boolean> {
    return this.#overlays.has(id)
  }

  protected override async registerCommand(
    _ctx: ExtensionContext,
    command: CommandView,
  ): Promise<unknown> {
    this.#registerCommand(command)
    return undefined
  }

  protected override repeat(_ctx: ExtensionContext, { everyMs, tick }: Repeat): void {
    const repeat = setInterval(tick, everyMs)
    repeat.unref()
    this.#repeats.push(repeat)
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
