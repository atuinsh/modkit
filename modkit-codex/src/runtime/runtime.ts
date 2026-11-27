import {
  ModkitTargetRuntime,
  type Followup,
  type HarnessAdapter,
  type PaneOpened,
  type Repeat,
  type UiNode,
  type Verdict,
} from '@atuin/modkit-target/host'

import { SHELL_TOOL, type HookEvent } from '../protocol'
import { callOf, resultOf } from './hooks'
import { exitFromTranscript, UNKNOWN_EXIT } from './transcript'

export interface CodexSession {
  readonly harness: HarnessAdapter
  readonly repeats: NodeJS.Timeout[]
}

export class CodexRuntime extends ModkitTargetRuntime<CodexSession> {
  #opening: Promise<void> | undefined = undefined

  async open(session: CodexSession): Promise<void> {
    this.#opening ??= this.start(session)
    return this.#opening
  }

  statusLine(): readonly (readonly UiNode[])[] {
    return this.statuses()
  }

  endTurn(): void {
    this.turnEnded()
  }

  async verdictOn(event: HookEvent & { event: 'PreToolUse' }): Promise<Verdict> {
    const call = callOf(event)
    return call === undefined ? undefined : this.verdictFor(call)
  }

  async followupOn(event: HookEvent & { event: 'PostToolUse' }): Promise<Followup> {
    if (!this.hasStarted) return {}
    const exit =
      event.tool === SHELL_TOOL && event.transcript !== null
        ? await exitFromTranscript({ path: event.transcript, id: event.toolUseId })
        : UNKNOWN_EXIT
    const result = resultOf({ event, exit })
    return result === undefined ? {} : this.followupFor(result)
  }

  protected override async adapter(session: CodexSession): Promise<HarnessAdapter> {
    return session.harness
  }

  // Codex asks for the status line when it draws one; nothing tells it to draw.
  protected override async redraw(): Promise<unknown> {
    return undefined
  }

  protected override async openPane(): Promise<PaneOpened> {
    return { isPlaced: false, reason: 'Codex draws no panes' }
  }

  protected override async closePane(): Promise<unknown> {
    return undefined
  }

  protected override async isPaneShown(): Promise<boolean> {
    return false
  }

  protected override async registerCommand(): Promise<unknown> {
    return undefined
  }

  protected override repeat(session: CodexSession, { everyMs, tick }: Repeat): void {
    session.repeats.push(setInterval(tick, everyMs))
  }
}
