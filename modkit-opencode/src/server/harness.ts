import type { Plugin } from '@opencode/plugin'

import { copy } from '@atuin/modkit-target-node/runtime/clipboard'
import { modelFor } from '@atuin/modkit-target-node/runtime/models'
import { projectRootOf, run } from '@atuin/modkit-target-node/runtime/run'
import type { Servers } from '@atuin/modkit-target-node/runtime/servers'
import type {
  Completion,
  CompletionRequest,
  Delivery,
  Failure,
  HarnessAdapter,
  Store,
} from '@atuin/modkit-target/host'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

async function completeWith({
  ctx,
  request,
}: {
  ctx: Pick<Plugin.Context, 'model' | 'experimental'>
  request: CompletionRequest
}): Promise<Completion> {
  try {
    const listed = await ctx.model.list()
    const models = listed.data.map((model) => ({ provider: model.providerID, id: model.modelID }))
    const model = modelFor({ wanted: request.model, models, current: undefined })
    if (model === undefined) {
      const detail = `opencode has no model ${request.model}`
      return { isAnswered: false, reason: 'refused', detail }
    }
    // One prompt is all opencode's generation takes: a system prompt leads it.
    const prompt =
      request.system === undefined ? request.prompt : `${request.system}\n\n${request.prompt}`
    const reply = await ctx.experimental.generate.text({
      prompt,
      model: { providerID: model.provider, id: model.id },
    })
    if (reply.text !== '') return { isAnswered: true, text: reply.text }
    const detail = `${model.provider}/${model.id} replied with no text`
    return { isAnswered: false, reason: 'empty-reply', detail }
  } catch (error) {
    return { isAnswered: false, reason: 'api-error', detail: messageOf(error) }
  }
}

async function injectInto({
  ctx,
  id,
  key,
  text,
}: {
  ctx: Pick<Plugin.Context, 'session'>
  id: string
  key: string
  text: string
}): Promise<Delivery> {
  try {
    await ctx.session.instructions.entry.put({ sessionID: id, key, value: text })
    return 'now'
  } catch {
    return 'dropped'
  }
}

export interface Reached {
  ctx: Pick<Plugin.Context, 'model' | 'experimental' | 'session'>
  plugin: string
  cwd: string
  servers: Servers
}

export function harnessFor({
  reached: { ctx, plugin, cwd, servers },
  id,
  store,
  notify,
  report,
}: {
  reached: Reached
  id: string
  store: Store
  notify: (text: string) => void
  report: (failure: Failure) => void
}): HarnessAdapter {
  let injected = 0
  return {
    session: { id },
    cwd: async () => cwd,
    root: async () => projectRootOf(cwd),
    env: async (name) => process.env[name],
    run: async (argv, options) => run({ argv, options, cwd }),
    mcp: async (call) => servers.call(call),
    complete: async (request) => completeWith({ ctx, request }),
    // The server part runs on the person's machine, so its clipboard is theirs.
    copy: async (text) => copy(text),
    notify: (text) => {
      notify(text)
      return 'now'
    },
    inject: async (text) => {
      injected += 1
      return injectInto({ ctx, id, key: `${plugin}-${injected}`, text })
    },
    now: () => Date.now(),
    store,
    report,
  }
}
