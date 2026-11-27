import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { modelFor } from '@atuin/modkit-target-node/runtime/models'
import { projectRootOf, run } from '@atuin/modkit-target-node/runtime/run'
import type { Servers } from '@atuin/modkit-target-node/runtime/servers'
import type {
  Completion,
  CompletionRequest,
  Copied,
  Failure,
  HarnessAdapter,
  Store,
} from '@atuin/modkit-target/host'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type Reply = Awaited<
  ReturnType<ReturnType<ExtensionContext['modelRegistry']['streamSimple']>['result']>
>

function completionOf({
  reply,
  model,
}: {
  reply: Reply
  model: { provider: string; id: string }
}): Completion {
  if (reply.stopReason === 'aborted') {
    return { isAnswered: false, reason: 'aborted', detail: reply.errorMessage ?? 'cut short' }
  }
  if (reply.stopReason === 'error') {
    return {
      isAnswered: false,
      reason: 'api-error',
      detail: reply.errorMessage ?? 'the provider failed',
    }
  }
  const text = reply.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
  if (text !== '') return { isAnswered: true, text }
  const name = `${model.provider}/${model.id}`
  return {
    isAnswered: false,
    reason: 'empty-reply',
    detail:
      reply.stopReason === 'length'
        ? `${name} reached its token cap before any text`
        : `${name} replied with no text`,
  }
}

async function copyWhereShown({
  ctx,
  text,
}: {
  ctx: ExtensionContext
  text: string
}): Promise<Copied> {
  if (!ctx.hasUI) return { isCopied: false, reason: 'no-surface' }
  try {
    await copyToClipboard(text)
    return { isCopied: true }
  } catch {
    return { isCopied: false, reason: 'no-clipboard' }
  }
}

async function completeWith({
  ctx,
  request,
}: {
  ctx: Pick<ExtensionContext, 'modelRegistry' | 'model'>
  request: CompletionRequest
}): Promise<Completion> {
  const model = modelFor({
    wanted: request.model,
    models: ctx.modelRegistry.getAvailable(),
    current: ctx.model,
  })
  if (model === undefined) {
    return {
      isAnswered: false,
      reason: 'refused',
      detail: `pi has no model ${request.model} with a login`,
    }
  }
  const signal =
    request.timeoutMs === undefined ? undefined : AbortSignal.timeout(request.timeoutMs)
  try {
    // Each of a mod's efforts is one of pi's levels, and pi's provider-neutral request thinks only
    // when given one. Its plain `complete` thinks hard unless told otherwise, which can spend a
    // small token cap before any text.
    const reply = await ctx.modelRegistry
      .streamSimple(
        model,
        {
          ...(request.system !== undefined && { systemPrompt: request.system }),
          messages: [{ role: 'user', content: request.prompt, timestamp: Date.now() }],
        },
        {
          ...(request.maxTokens !== undefined && { maxTokens: request.maxTokens }),
          ...(request.effort !== undefined && { reasoning: request.effort }),
          ...(signal !== undefined && { signal }),
        },
      )
      .result()
    return completionOf({ reply, model })
  } catch (error) {
    const reason = signal?.aborted === true ? 'aborted' : 'api-error'
    return { isAnswered: false, reason, detail: messageOf(error) }
  }
}

export function harnessFor({
  pi,
  ctx,
  plugin,
  servers,
  store,
  report,
}: {
  pi: Pick<ExtensionAPI, 'sendMessage'>
  ctx: ExtensionContext
  plugin: string
  servers: Servers
  store: Store
  report: (failure: Failure) => void
}): HarnessAdapter {
  const { cwd } = ctx
  return {
    session: { id: ctx.sessionManager.getSessionId() },
    cwd: async () => cwd,
    // The session's directory is the same for its whole life: pi has no `/cd`.
    root: async () => projectRootOf(cwd),
    env: async (name) => process.env[name],
    run: async (argv, options) => run({ argv, options, cwd }),
    mcp: async (call) => servers.call(call),
    complete: async (request) => completeWith({ ctx, request }),
    copy: async (text) => copyWhereShown({ ctx, text }),
    notify: (text) => {
      if (!ctx.hasUI) return 'dropped'
      ctx.ui.notify(text, 'info')
      return 'now'
    },
    inject: async (text) => {
      pi.sendMessage(
        { customType: plugin, content: text, display: false },
        { deliverAs: 'nextTurn' },
      )
      return 'queued'
    },
    now: () => Date.now(),
    store,
    report,
  }
}
