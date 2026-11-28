import type { Plugin } from '@opencode/plugin'
import { isPlainObject } from 'es-toolkit/predicate'

import type { Followup } from '@atuin/modkit-target/host'

import { withContext, type OcCall, type OcResult } from './hooks.ts'
import type { Live, Sessions } from './sessions.ts'

function callIdOf(source: unknown): string | undefined {
  const id: unknown = isPlainObject(source) ? source['id'] : undefined
  return typeof id === 'string' ? id : undefined
}

async function checkBefore({
  sessions,
  event,
  cwd,
}: {
  sessions: Sessions
  event: OcCall & { readonly sessionID: string }
  cwd: string
}): Promise<{ readonly deny: string } | undefined> {
  try {
    const live = await sessions.live(event.sessionID)
    const verdict = await live?.runtime.verdictOn({ call: event, cwd })
    if (live === undefined || verdict === undefined) return undefined
    if ('deny' in verdict) return verdict
    live.asks.set(event.id, verdict)
    return undefined
  } catch {
    // A fault in the mod fails open so the tool call is never blocked by an unexpected crash.
    return undefined
  }
}

type AfterEvent = OcCall & { readonly sessionID: string } & (
    | { readonly status: 'completed'; result: OcResult }
    | { readonly status: 'error'; readonly error: { readonly message: string } }
  )

async function followupFor({
  live,
  event,
  cwd,
}: {
  live: Live | undefined
  event: AfterEvent
  cwd: string
}): Promise<Followup | undefined> {
  if (live === undefined) return undefined
  return event.status === 'completed'
    ? live.runtime.followupOn({ call: event, result: event.result, cwd })
    : live.runtime.followupOnFailed({ call: event, message: event.error.message, cwd })
}

async function handleAfter({
  sessions,
  event,
  cwd,
}: {
  sessions: Sessions
  event: AfterEvent
  cwd: string
}): Promise<void> {
  try {
    const live = await sessions.live(event.sessionID)
    // Drop any pending ask that bypassed permission evaluation (e.g. cancelled or auto-allowed).
    live?.asks.delete(event.id)
    const followup = await followupFor({ live, event, cwd })
    if (followup?.note !== undefined) sessions.notify({ id: event.sessionID, text: followup.note })
    if (followup?.context !== undefined && event.status === 'completed') {
      // oxlint-disable-next-line eslint/no-param-reassign -- opencode reads a hook's answer off its event
      event.result = withContext({ result: event.result, context: followup.context })
    }
  } catch {
    // A fault in the mod adds nothing: the result stands as the tool gave it.
  }
}

export async function hookCalls({
  ctx,
  sessions,
}: {
  ctx: Plugin.Context
  sessions: Sessions
}): Promise<void> {
  const { cwd } = sessions
  await ctx.tool.hook('execute.before', async (event) => {
    const denied = await checkBefore({ sessions, event, cwd })
    if (denied !== undefined) throw new Error(denied.deny)
  })
  await ctx.permission.hook('evaluate', (event) => {
    const id = callIdOf(event.source)
    if (id === undefined || event.effect === 'deny') return
    const live = sessions.all().find((one) => one.asks.has(id))
    const ask = live?.asks.get(id)
    if (live === undefined || ask === undefined) return
    live.asks.delete(id)
    // oxlint-disable-next-line eslint/no-param-reassign -- opencode reads a hook's answer off its event
    event.effect = 'ask'
    // oxlint-disable-next-line eslint/no-param-reassign -- as above
    event.message = ask.ask
  })
  await ctx.tool.hook('execute.after', async (event) => handleAfter({ sessions, event, cwd }))
}
