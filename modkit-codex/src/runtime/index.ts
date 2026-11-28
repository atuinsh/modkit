import * as v from 'valibot'

import { INVALID_PARAMS, RpcError } from '@atuin/modkit-target-node/runtime/errors'
import { peerOn, type Peer } from '@atuin/modkit-target-node/runtime/rpc'
import { RpcMethod } from '@atuin/modkit-target-node/runtime/rpc-method'
import { RpcRouter } from '@atuin/modkit-target-node/runtime/rpc-router'
import { errorMessage, ModVerdict, type Followup } from '@atuin/modkit-target/host'

import {
  CodexHookEvent,
  HOOK_TOOL,
  STATUSLINE_TOOL,
  type Decision,
  type WireHookOutput,
} from '../protocol.ts'
import { Sessions, type LiveSession, type Served } from './sessions.ts'
import { CodexStatusLine } from './statusline.ts'

export type { Served } from './sessions.ts'

const PROTOCOL_VERSION = '2025-06-18'
const STATUSLINE_STATE = 'com.openai/codex-statusline-state'

const ASK_SCHEMA = {
  type: 'object',
  properties: { run: { type: 'boolean', title: 'Go ahead', default: false } },
  required: ['run'],
} as const

type Json = Readonly<Record<string, unknown>>

const OptionalParams = v.optional(v.unknown())

const InitializeMethod = RpcMethod.define({
  name: 'initialize',
  params: v.optional(
    v.object({
      protocolVersion: v.optional(v.string()),
      capabilities: v.optional(
        v.object({ elicitation: v.optional(v.record(v.string(), v.unknown())) }),
      ),
    }),
    {},
  ),
  result: v.unknown(),
})

const PingMethod = RpcMethod.define({ name: 'ping', params: OptionalParams, result: v.unknown() })

const ToolsListMethod = RpcMethod.define({
  name: 'tools/list',
  params: OptionalParams,
  result: v.unknown(),
})

const ToolsCallMethod = RpcMethod.define({
  name: 'tools/call',
  params: v.object({ name: v.string(), arguments: v.optional(v.unknown()) }),
  result: v.unknown(),
})

const ResourcesListMethod = RpcMethod.define({
  name: 'resources/list',
  params: OptionalParams,
  result: v.unknown(),
})

const ResourceTemplatesListMethod = RpcMethod.define({
  name: 'resources/templates/list',
  params: OptionalParams,
  result: v.unknown(),
})

const ResourcesReadMethod = RpcMethod.define({
  name: 'resources/read',
  params: v.object({
    uri: v.string(),
    _meta: v.optional(
      v.object({
        [STATUSLINE_STATE]: v.optional(
          v.object({
            thread: v.optional(
              v.object({
                id: v.optional(v.string()),
                workspace: v.optional(v.object({ cwd: v.optional(v.string()) })),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
  result: v.unknown(),
})

const ElicitMethod = RpcMethod.define({
  name: 'elicitation/create',
  params: v.object({ message: v.string(), requestedSchema: v.unknown() }),
  result: v.object({
    action: v.picklist(['accept', 'decline', 'cancel']),
    content: v.optional(v.record(v.string(), v.unknown())),
  }),
})

const statusUri = (plugin: string): string => `ui://${plugin}/statusline`

function listTools(served: Served): readonly Json[] {
  // `visibility` without "model" keeps a tool out of the model's list (MCP Apps), as only Codex's
  // hooks and its status line picker are meant to call these.
  const hidden = { ui: { visibility: ['app'] } }
  const hook = {
    name: HOOK_TOOL,
    description: `${served.plugin}'s hooks: Codex calls this on each hook, and nothing else should`,
    inputSchema: { type: 'object' },
    _meta: hidden,
  }
  if (!served.hasStatus) return [hook]
  const status = {
    name: STATUSLINE_TOOL,
    title: served.plugin,
    description: `${served.plugin}'s status line`,
    inputSchema: { type: 'object', properties: {} },
    _meta: {
      ...hidden,
      'openai/ui': {
        entrypoints: [{ type: 'statusline', resourceUri: statusUri(served.plugin) }],
      },
    },
  }
  return [hook, status]
}

interface Acted {
  decision: Decision
  followup: Followup
}

const NOTHING: Acted = { decision: { kind: 'none' }, followup: {} }

class Server implements Disposable {
  readonly #served: Served
  readonly #sessions: Sessions
  readonly #router: RpcRouter
  #peer: Peer | undefined = undefined
  #canElicit = false

  constructor(served: Served) {
    this.#served = served
    this.#sessions = new Sessions(served)
    this.#router = RpcRouter.create()
      .handle(InitializeMethod, (params) => this.#initialize(params))
      .handle(PingMethod, () => ({}))
      .handle(ToolsListMethod, () => ({ tools: listTools(this.#served) }))
      .handle(ToolsCallMethod, async (params) => this.#toolCall(params))
      .handle(ResourcesListMethod, () => this.#resources())
      .handle(ResourceTemplatesListMethod, () => ({ resourceTemplates: [] }))
      .handle(ResourcesReadMethod, async (params) => this.#read(params))
  }

  async answer(call: { method: string; params: unknown }): Promise<unknown> {
    return this.#router.dispatch(call)
  }

  async run(peer: Peer): Promise<void> {
    this.#peer = peer
    await peer.closed
  }

  [Symbol.dispose](): void {
    this.#sessions[Symbol.dispose]()
  }

  #initialize(params: {
    protocolVersion?: string | undefined
    capabilities?: { elicitation?: Record<string, unknown> | undefined } | undefined
  }): Json {
    this.#canElicit = params.capabilities?.elicitation !== undefined
    return {
      protocolVersion: params.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: `${this.#served.plugin}-mod`, version: this.#served.version },
    }
  }

  async #elicit(ask: string): Promise<boolean | undefined> {
    if (this.#peer === undefined || !this.#canElicit) return undefined
    try {
      const answer = await this.#peer.call(ElicitMethod, {
        params: { message: `${this.#served.plugin}: ${ask}`, requestedSchema: ASK_SCHEMA },
      })
      return answer.action === 'accept' && answer.content?.['run'] === true
    } catch {
      return undefined
    }
  }

  async #act({ live, event }: { live: LiveSession; event: CodexHookEvent }): Promise<Acted> {
    const { runtime } = live
    if (runtime === undefined) return NOTHING
    switch (event.kind) {
      case 'Stop':
        runtime.endTurn()
        return NOTHING
      case 'PreToolUse': {
        const verdict = ModVerdict.from(await runtime.verdictOn(event))
        const outcome = await verdict.resolve({
          canAsk: event.canAsk,
          confirm: async (ask) => this.#elicit(ask),
        })
        if (!outcome.allow) {
          return { ...NOTHING, decision: { kind: 'deny', reason: outcome.reason } }
        }
        if (outcome.note !== undefined) live.queueNote(outcome.note)
        return NOTHING
      }
      case 'PostToolUse':
        return { ...NOTHING, followup: await runtime.followupOn(event) }
      // A session's first hook mounts the mod and tells it the session started, whichever it is.
      case 'SessionStart':
      case 'UserPromptSubmit':
        break
    }
    return NOTHING
  }

  async #hook(args: unknown): Promise<WireHookOutput> {
    const event = CodexHookEvent.parse(args)
    const live = await this.#sessions.open({ id: event.sessionId, cwd: event.cwd })
    const { decision, followup } = await this.#act({ live, event })
    return event.reply({ delivered: live.drain(event.carriesContext), followup, decision })
  }

  async #statusLine(
    thread:
      | { id?: string | undefined; workspace?: { cwd?: string | undefined } | undefined }
      | undefined,
  ): Promise<string> {
    const id = thread?.id
    if (id === undefined) return JSON.stringify(null)
    const cwd = thread?.workspace?.cwd
    // A thread the hooks haven't reached yet, as before its first turn, mounts here.
    const live =
      this.#sessions.known(id) ??
      (cwd === undefined ? undefined : await this.#sessions.open({ id, cwd }))
    return JSON.stringify(CodexStatusLine.render(live?.runtime?.statusLine() ?? []))
  }

  async #toolCall({
    name,
    arguments: args,
  }: {
    name: string
    arguments?: unknown
  }): Promise<unknown> {
    if (name === HOOK_TOOL) {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await this.#hook(args)) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: errorMessage(error) }] }
      }
    }
    if (name === STATUSLINE_TOOL && this.#served.hasStatus) {
      return {
        content: [{ type: 'text', text: `The status line is ${statusUri(this.#served.plugin)}.` }],
      }
    }
    throw new RpcError({ code: INVALID_PARAMS, message: `no tool ${name}` })
  }

  async #read(params: {
    uri: string
    _meta?:
      | {
          [STATUSLINE_STATE]?:
            | {
                thread?:
                  | {
                      id?: string | undefined
                      workspace?: { cwd?: string | undefined } | undefined
                    }
                  | undefined
              }
            | undefined
        }
      | undefined
  }): Promise<unknown> {
    const { uri, _meta: meta } = params
    if (!this.#served.hasStatus || uri !== statusUri(this.#served.plugin)) {
      throw new RpcError({ code: INVALID_PARAMS, message: `no resource ${uri}` })
    }
    const text = await this.#statusLine(meta?.[STATUSLINE_STATE]?.thread)
    return { contents: [{ uri, mimeType: 'application/json', text }] }
  }

  #resources(): unknown {
    if (!this.#served.hasStatus) return { resources: [] }
    const uri = statusUri(this.#served.plugin)
    return { resources: [{ name: 'statusline', uri, mimeType: 'application/json' }] }
  }
}

export async function serve(served: Served): Promise<void> {
  using server = new Server(served)
  using peer = peerOn({
    input: process.stdin,
    output: process.stdout,
    onRequest: async (call) => server.answer(call),
  })
  await server.run(peer)
}
