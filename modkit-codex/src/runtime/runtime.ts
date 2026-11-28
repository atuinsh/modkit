import { NodeTargetRuntime } from '@atuin/modkit-target-node/runtime/node-runtime'
import type {
  Followup,
  HarnessAdapter,
  Images,
  Mod,
  Options,
  RuntimeHosts,
  UiNode,
  Verdict,
} from '@atuin/modkit-target/host'

import { CODEX_CAPABILITIES, type CodexCapabilities, type CodexHookEvent } from '../protocol.ts'
import { exitFromTranscript, UNKNOWN_EXIT } from './transcript.ts'

export interface CodexSession {
  readonly harness: HarnessAdapter
}

export class CodexRuntime extends NodeTargetRuntime<CodexSession, CodexCapabilities> {
  constructor({ mod, options, images }: { mod: Mod<Options>; options: Options; images: Images }) {
    super({ mod, options, images, capabilities: CODEX_CAPABILITIES })
  }

  async open(session: CodexSession): Promise<void> {
    return this.start(session)
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

  protected override hosts(): RuntimeHosts<CodexSession, CodexCapabilities> {
    return {}
  }
}
