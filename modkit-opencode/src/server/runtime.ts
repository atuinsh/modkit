import { NodeTargetRuntime } from '@atuin/modkit-target-node/runtime/node-runtime'
import {
  PaneId,
  type CommandHost,
  type CommandView,
  type Followup,
  type HarnessAdapter,
  type PaneHost,
  type Verdict,
  type ViewHost,
} from '@atuin/modkit-target/host'

import { callOf, failedResultOf, resultOf, type OcCall, type OcResult } from './hooks'
import { NOTHING_DRAWN, viewJsonOf, type Drawn, type OpenPane } from './view'

export interface OpencodeSession {
  readonly harness: HarnessAdapter
  readonly changed: () => void
}

export class OpencodeRuntime extends NodeTargetRuntime<OpencodeSession> {
  readonly #commands: Pick<CommandView, 'name' | 'description'>[] = []
  // The panes on show and their titles, oldest first: the TUI part draws the newest.
  readonly #panes = new Map<string, string>()
  #opening: Promise<void> | undefined = undefined

  protected override readonly panes: PaneHost<OpencodeSession> = {
    open: (session, { id, title }) => {
      this.#panes.set(id.toString(), title)
      session.changed()
      return { isPlaced: true }
    },
    close: (session, id) => {
      this.#panes.delete(id.toString())
      session.changed()
    },
    isShown: (_session, id) => this.#panes.has(id.toString()),
  }

  protected override readonly commands: CommandHost<OpencodeSession> = {
    register: (_session, { name, description }) => {
      this.#commands.push({ name, description })
    },
  }

  protected override readonly view: ViewHost<OpencodeSession> = {
    redraw: (session) => {
      session.changed()
    },
  }

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
    await this.panes.close(session, PaneId.parse(pane))
    await this.dismiss(pane)
  }

  async verdictOn({ call, cwd }: { call: OcCall; cwd: string }): Promise<Verdict> {
    return this.verdictFor(callOf({ call, cwd }))
  }

  async followupOn(input: { call: OcCall; result: OcResult; cwd: string }): Promise<Followup> {
    const result = resultOf(input)
    return result === undefined ? {} : this.followupFor(result)
  }

  async followupOnFailed(failed: {
    call: OcCall
    message: string
    cwd: string
  }): Promise<Followup> {
    return this.followupFor(failedResultOf(failed))
  }

  protected override adapter(session: OpencodeSession): HarnessAdapter {
    return session.harness
  }
}
