import { join } from 'node:path'

import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { NodeHarness } from '@atuin/modkit-target-node/runtime/harness'
import { ModelCatalog } from '@atuin/modkit-target-node/runtime/models'
import { Servers } from '@atuin/modkit-target-node/runtime/servers'
import { FileStore, type Tags } from '@atuin/modkit-target-node/runtime/store'
import {
  errorMessage,
  FailureReporter,
  type Completion,
  type CompletionRequest,
  type Copied,
  type Failure,
  type HarnessAdapter,
  type Store,
} from '@atuin/modkit-target/host'

import { PiMcpConfig } from './mcp.ts'

type Reply = Awaited<
  ReturnType<ReturnType<ExtensionContext['modelRegistry']['streamSimple']>['result']>
>

function parseCompletion({
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
  sessionSignal,
}: {
  ctx: Pick<ExtensionContext, 'modelRegistry' | 'model'>
  request: CompletionRequest
  sessionSignal: AbortSignal
}): Promise<Completion> {
  const model = ModelCatalog.from(ctx.modelRegistry.getAvailable()).resolve(request.model, {
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
    request.timeoutMs === undefined
      ? sessionSignal
      : AbortSignal.any([sessionSignal, AbortSignal.timeout(request.timeoutMs)])
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
          signal,
        },
      )
      .result()
    return parseCompletion({ reply, model })
  } catch (error) {
    const reason = signal.aborted ? 'aborted' : 'api-error'
    return { isAnswered: false, reason, detail: errorMessage(error) }
  }
}

export interface PiSessionResources extends Disposable {
  readonly harness: HarnessAdapter
  readonly report: (failure: Failure) => void
}

function buildPiHarness({
  pi,
  ctx,
  plugin,
  servers,
  store,
  report,
  signal,
}: {
  pi: Pick<ExtensionAPI, 'sendMessage'>
  ctx: ExtensionContext
  plugin: string
  servers: Servers
  store: Store
  report: (failure: Failure) => void
  signal: AbortSignal
}): HarnessAdapter {
  return NodeHarness.builder({
    sessionId: ctx.sessionManager.getSessionId(),
    cwd: ctx.cwd,
    servers,
    store,
    report,
    signal,
  })
    .withComplete(async (request) => completeWith({ ctx, request, sessionSignal: signal }))
    .withCopy(async (text) => copyWhereShown({ ctx, text }))
    .withNotify((text) => {
      if (!ctx.hasUI) return 'dropped'
      ctx.ui.notify(text, 'info')
      return 'now'
    })
    .withInject(async (text) => {
      pi.sendMessage(
        { customType: plugin, content: text, display: false },
        { deliverAs: 'nextTurn' },
      )
      return 'queued'
    })
    .build()
}

export function createSessionResources({
  pi,
  ctx,
  plugin,
  dir,
  state,
  signal,
}: {
  pi: Pick<ExtensionAPI, 'sendMessage'>
  ctx: ExtensionContext
  plugin: string
  dir: string
  state: Tags
  signal: AbortSignal
}): PiSessionResources {
  const { report } = FailureReporter.for({
    plugin,
    notify: (line) => {
      if (ctx.hasUI) ctx.ui.notify(line, 'error')
    },
  })
  const mcp = new PiMcpConfig({ cwd: ctx.cwd, isTrusted: ctx.isProjectTrusted() })
  const servers = new Servers({
    find: async (name) => mcp.resolve(name),
  })
  const store = FileStore.open({
    dir: join(dir, 'sessions'),
    session: ctx.sessionManager.getSessionId(),
    tags: state,
    report,
  })
  const harness = buildPiHarness({ pi, ctx, plugin, servers, store, report, signal })
  return {
    harness,
    report,
    [Symbol.dispose]: () => {
      store[Symbol.dispose]()
      servers[Symbol.dispose]()
    },
  }
}
