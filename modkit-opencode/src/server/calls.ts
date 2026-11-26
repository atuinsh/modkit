import type { Plugin } from '@opencode/plugin'
import { isPlainObject } from 'es-toolkit/predicate'

import { withContext } from './hooks'
import type { Sessions } from './sessions'

function callIdOf(source: unknown): string | undefined {
  const id: unknown = isPlainObject(source) ? source['id'] : undefined
  return typeof id === 'string' ? id : undefined
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
    const live = await sessions.live(event.sessionID)
    const verdict = await live?.runtime.verdictOn({ call: event, cwd })
    if (live === undefined || verdict === undefined) return
    if ('deny' in verdict) throw new Error(verdict.deny)
    live.asks.set(event.id, verdict)
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
  await ctx.tool.hook('execute.after', async (event) => {
    try {
      const live = await sessions.live(event.sessionID)
      // A call that ended in an error has no result for a followup's context to join.
      const followup =
        event.status === 'completed'
          ? await live?.runtime.followupOn({ call: event, result: event.result, cwd })
          : await live?.runtime.followupOnFailed({ call: event, message: event.error.message, cwd })
      if (followup?.note !== undefined) {
        sessions.notify({ id: event.sessionID, text: followup.note })
      }
      if (followup?.context !== undefined && event.status === 'completed') {
        // oxlint-disable-next-line eslint/no-param-reassign -- opencode reads a hook's answer off its event
        event.result = withContext({ result: event.result, context: followup.context })
      }
    } catch {
      // A fault in the mod adds nothing: the result stands as the tool gave it.
    }
  })
}
