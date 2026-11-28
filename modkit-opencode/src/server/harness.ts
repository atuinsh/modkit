import type { Plugin } from '@opencode/plugin'

import { NodeHarness } from '@atuin/modkit-target-node/runtime/harness'
import { ModelCatalog } from '@atuin/modkit-target-node/runtime/models'
import type { Servers } from '@atuin/modkit-target-node/runtime/servers'
import {
  errorMessage,
  type Completion,
  type CompletionRequest,
  type Delivery,
  type Failure,
  type HarnessAdapter,
  type Store,
} from '@atuin/modkit-target/host'

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
    const model = ModelCatalog.from(models).resolve(request.model)
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
    return { isAnswered: false, reason: 'api-error', detail: errorMessage(error) }
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

export function buildHarness({
  reached: { ctx, plugin, cwd, servers },
  id,
  store,
  notify,
  report,
  signal,
}: {
  reached: Reached
  id: string
  store: Store
  notify: (text: string) => void
  report: (failure: Failure) => void
  signal: AbortSignal
}): HarnessAdapter {
  let injected = 0
  return NodeHarness.builder({ sessionId: id, cwd, servers, store, report, signal })
    .withComplete(async (request) => completeWith({ ctx, request }))
    .withNotify((text) => {
      notify(text)
      return 'now'
    })
    .withInject(async (text) => {
      injected += 1
      return injectInto({ ctx, id, key: `${plugin}-${injected}`, text })
    })
    .build()
}
