import { NodeTargetRuntime } from '@atuin/modkit-target-node/runtime/node-runtime'
import {
  PaneId,
  type CommandView,
  type Followup,
  type HarnessAdapter,
  type Images,
  type Mod,
  type Options,
  type RuntimeHosts,
  type Verdict,
} from '@atuin/modkit-target/host'

import { OPENCODE_CAPABILITIES, type OpencodeCapabilities } from '../contract.ts'
import { callOf, failedResultOf, resultOf, type OcCall, type OcResult } from './hooks.ts'
import { NOTHING_DRAWN, viewJsonOf, type Drawn, type OpenPane } from './view.ts'

export interface OpencodeSession {
  readonly harness: HarnessAdapter
  readonly store: Disposable
  readonly changed: () => void
}

export class OpencodeRuntime extends NodeTargetRuntime<OpencodeSession, OpencodeCapabilities> {
  readonly #commands: Pick<CommandView, 'name' | 'description'>[] = []
  // The panes on show and their titles, oldest first: the TUI part draws the newest.
  readonly #panes = new Map<string, string>()

  constructor({ mod, options, images }: { mod: Mod<Options>; options: Options; images: Images }) {
    super({ mod, options, images, capabilities: OPENCODE_CAPABILITIES })
  }

  async open(session: OpencodeSession): Promise<void> {
    return this.start(session)
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
    this.own(session.store)
    return session.harness
  }

  protected override hosts(): RuntimeHosts<OpencodeSession, OpencodeCapabilities> {
    return {
      panes: {
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
      },
      commands: {
        register: (_session, { name, description }) => {
          this.#commands.push({ name, description })
        },
      },
      view: {
        redraw: (session) => {
          session.changed()
        },
      },
    }
  }
}
