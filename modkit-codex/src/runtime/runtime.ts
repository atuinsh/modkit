import { NodeTargetRuntime } from '@atuin/modkit-target-node/runtime/node-runtime'
import {
  NopPaneHost,
  type Followup,
  type HarnessAdapter,
  type PaneHost,
  type UiNode,
  type Verdict,
} from '@atuin/modkit-target/host'

import type { CodexHookEvent } from '../protocol'
import { exitFromTranscript, UNKNOWN_EXIT } from './transcript'

export interface CodexSession {
  readonly harness: HarnessAdapter
}

export class CodexRuntime extends NodeTargetRuntime<CodexSession> {
  protected override readonly panes: PaneHost<CodexSession> = new NopPaneHost(
    'Codex draws no panes',
  )
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

  async verdictOn(event: CodexHookEvent): Promise<Verdict> {
    const call = event.toCall()
    return call === undefined ? undefined : this.verdictFor(call)
  }

  async followupOn(event: CodexHookEvent): Promise<Followup> {
    if (!this.hasStarted) return {}
    const { transcriptPath: transcript, toolUseId } = event
    const exit =
      event.isShellTool && transcript !== null && toolUseId !== undefined
        ? await exitFromTranscript({ path: transcript, id: toolUseId })
        : UNKNOWN_EXIT
    const result = event.toResult(exit)
    return result === undefined ? {} : this.followupFor(result)
  }

  protected override adapter(session: CodexSession): HarnessAdapter {
    return session.harness
  }
}
