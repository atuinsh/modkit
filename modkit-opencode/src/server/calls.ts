import type { Plugin } from '@opencode/plugin'

import { asRecord, type Followup } from '@atuin/modkit-target/host'

import { OpencodeEvent, type OcCall, type OcResult } from './hooks.ts'
import type { Live, Sessions } from './sessions.ts'

type AfterEvent = OcCall & { readonly sessionID: string } & (
    | { readonly status: 'completed'; result: OcResult }
    | { readonly status: 'error'; readonly error: { readonly message: string } }
  )

function callIdOf(source: unknown): string | undefined {
  const { id } = asRecord(source)
  return typeof id === 'string' ? id : undefined
}

/** Wires opencode tool execution and permission hooks into modkit {@link Sessions}. */
export class OpencodeCallHooks {
  readonly #sessions: Sessions

  constructor(sessions: Sessions) {
    this.#sessions = sessions
  }

  /** Register `execute.before`, `permission.evaluate`, and `execute.after` hooks on `ctx`. */
  async attach(ctx: Plugin.Context): Promise<void> {
    await ctx.tool.hook('execute.before', async (event) => {
      const denied = await this.#checkBefore(event)
      if (denied !== undefined) throw new Error(denied.deny)
    })
    await ctx.permission.hook('evaluate', (event) => {
      this.#evaluatePermission(event)
    })
    await ctx.tool.hook('execute.after', async (event) => this.#handleAfter(event))
  }

  async #checkBefore(
    event: OcCall & { readonly sessionID: string },
  ): Promise<{ readonly deny: string } | undefined> {
    try {
      const live = await this.#sessions.live(event.sessionID)
      const verdict = await live?.runtime.verdictOn({ call: event, cwd: this.#sessions.cwd })
      if (live === undefined || verdict === undefined) return undefined
      if ('deny' in verdict) return verdict
      live.asks.set(event.id, verdict)
      return undefined
    } catch {
      // A fault in the mod fails open so the tool call is never blocked by an unexpected crash.
      return undefined
    }
  }

  #evaluatePermission(event: { source?: unknown; effect: string; message?: string }): void {
    const id = callIdOf(event.source)
    if (id === undefined || event.effect === 'deny') return
    const live = this.#sessions.all().find((one) => one.asks.has(id))
    const ask = live?.asks.get(id)
    if (live === undefined || ask === undefined) return
    live.asks.delete(id)
    // oxlint-disable-next-line eslint/no-param-reassign -- opencode reads a hook's answer off its event
    event.effect = 'ask'
    // oxlint-disable-next-line eslint/no-param-reassign -- as above
    event.message = ask.ask
  }

  async #followupFor(live: Live | undefined, event: AfterEvent): Promise<Followup | undefined> {
    if (live === undefined) return undefined
    const { cwd } = this.#sessions
    return event.status === 'completed'
      ? live.runtime.followupOn({ call: event, result: event.result, cwd })
      : live.runtime.followupOnFailed({ call: event, message: event.error.message, cwd })
  }

  async #handleAfter(event: AfterEvent): Promise<void> {
    try {
      const live = await this.#sessions.live(event.sessionID)
      // Drop any pending ask that bypassed permission evaluation (e.g. cancelled or auto-allowed).
      live?.asks.delete(event.id)
      const followup = await this.#followupFor(live, event)
      if (followup?.note !== undefined) {
        this.#sessions.notify({ id: event.sessionID, text: followup.note })
      }
      if (followup?.context !== undefined && event.status === 'completed') {
        // oxlint-disable-next-line eslint/no-param-reassign -- opencode reads a hook's answer off its event
        event.result = OpencodeEvent.withContext({
          result: event.result,
          context: followup.context,
        })
      }
    } catch {
      // A fault in the mod adds nothing: the result stands as the tool gave it.
    }
  }
}
