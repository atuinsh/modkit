import {
  ModkitTargetRuntime,
  type CommandView,
  type Followup,
  type HarnessAdapter,
  type PaneOpened,
  type PaneOpening,
  type Repeat,
  type Verdict,
} from '@atuin/modkit-target/host'

import {
  shellCallOf,
  shellResultOf,
  toolCallOf,
  toolResultOf,
  type OcCall,
  type OcResult,
} from './hooks'
import { NOTHING_DRAWN, viewJsonOf, type Drawn, type OpenPane } from './view'

export interface OpencodeSession {
  readonly harness: HarnessAdapter
  readonly changed: () => void
  readonly repeats: NodeJS.Timeout[]
}

export class OpencodeRuntime extends ModkitTargetRuntime<OpencodeSession> {
  readonly #commands: Pick<CommandView, 'name' | 'description'>[] = []
  // The panes on show and their titles, oldest first: the TUI part draws the newest.
  readonly #panes = new Map<string, string>()
  #opening: Promise<void> | undefined = undefined

  async open(session: OpencodeSession): Promise<void> {
    this.#opening ??= this.start(session)
    return this.#opening
  }

  drawn(): Drawn {
    if (!this.hasStarted) return NOTHING_DRAWN
    const open = [...this.#panes].flatMap(([id, title]): OpenPane[] => {
      const body = this.paneBody(id)
      return body === undefined ? [] : [{ id, title, body }]
    })
    return viewJsonOf({ statuses: this.statuses(), open, commands: this.#commands })
  }

  endTurn(): void {
    this.turnEnded()
  }

  pressed(session: OpencodeSession, button: string): void {
    const node = this.drawn().buttons.get(button)
    if (node !== undefined) this.press(session, { button: node, surface: 'terminal' })
  }

  async run(session: OpencodeSession, name: string): Promise<string | undefined> {
    return this.answerCommand(session, name)
  }

  async close(session: OpencodeSession, pane: string): Promise<void> {
    await this.closePane(session, pane)
    await this.dismiss(pane)
  }

  async verdictOn({ call, cwd }: { call: OcCall; cwd: string }): Promise<Verdict> {
    const shell = shellCallOf({ call, cwd })
    return shell === undefined
      ? this.beforeTool(toolCallOf({ call, cwd }))
      : this.beforeShell(shell)
  }

  async followupOn({
    call,
    result,
    cwd,
  }: {
    call: OcCall
    result: OcResult
    cwd: string
  }): Promise<Followup> {
    const shell = shellResultOf({ call, result, cwd })
    if (shell !== undefined) return this.afterShell(shell)
    // A shell call still running has no result for the mod yet.
    if (shellCallOf({ call, cwd }) !== undefined) return {}
    return this.afterTool(toolResultOf({ call, result, cwd }))
  }

  protected override async adapter(session: OpencodeSession): Promise<HarnessAdapter> {
    return session.harness
  }

  protected override async redraw(session: OpencodeSession): Promise<unknown> {
    session.changed()
    return undefined
  }

  protected override async openPane(
    session: OpencodeSession,
    { id, title }: PaneOpening,
  ): Promise<PaneOpened> {
    this.#panes.set(id, title)
    session.changed()
    return { isPlaced: true }
  }

  protected override async closePane(session: OpencodeSession, id: string): Promise<unknown> {
    this.#panes.delete(id)
    session.changed()
    return undefined
  }

  protected override async isPaneShown(_session: OpencodeSession, id: string): Promise<boolean> {
    return this.#panes.has(id)
  }

  protected override async registerCommand(
    _session: OpencodeSession,
    { name, description }: CommandView,
  ): Promise<unknown> {
    this.#commands.push({ name, description })
    return undefined
  }

  protected override repeat(session: OpencodeSession, { everyMs, tick }: Repeat): void {
    session.repeats.push(setInterval(tick, everyMs).unref())
  }
}
