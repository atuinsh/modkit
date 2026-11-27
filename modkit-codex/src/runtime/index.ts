import { isPlainObject } from 'es-toolkit/predicate'

import {
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  RpcError,
} from '@atuin/modkit-target-node/runtime/errors'
import { peerOn, type Peer } from '@atuin/modkit-target-node/runtime/rpc'
import type { Followup } from '@atuin/modkit-target/host'

import {
  carriesContext,
  HOOK_TOOL,
  parseHook,
  serverNameOf,
  STATUSLINE_TOOL,
  type HookEvent,
} from '../protocol'
import { answerOf, ASK_SCHEMA, decide, type Answer } from './ask'
import { hookOutputOf, withFollowup, type Decision, type Delivered } from './hooks'
import { Sessions, type Live, type Served } from './sessions'
import { statusLineOf } from './statusline'

export type { Served } from './sessions'

const PROTOCOL_VERSION = '2025-06-18'

const STATUSLINE_STATE = 'com.openai/codex-statusline-state'

type Json = Readonly<Record<string, unknown>>

const recordOf = (value: unknown): Json => (isPlainObject(value) ? value : {})

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const statusUri = (plugin: string): string => `ui://${plugin}/statusline`

function toolsOf(served: Served): readonly Json[] {
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

function drained({ live, event }: { live: Live; event: HookEvent['event'] }): Delivered {
  const notes = live.state.notes.splice(0)
  const context = carriesContext(event) ? live.state.context.splice(0) : []
  return { notes, context }
}

interface Acted {
  decision: Decision
  followup: Followup
}

const NOTHING: Acted = { decision: { kind: 'none' }, followup: {} }

// The thread a status line read is for, which Codex names in the request's `_meta`.
function threadOf(params: unknown): { id: string; cwd: string | undefined } | undefined {
  const { thread } = recordOf(recordOf(recordOf(params)['_meta'])[STATUSLINE_STATE])
  const { id, workspace } = recordOf(thread)
  const { cwd } = recordOf(workspace)
  if (typeof id !== 'string') return undefined
  return { id, cwd: typeof cwd === 'string' ? cwd : undefined }
}

class Server {
  readonly #served: Served
  readonly #sessions: Sessions
  #peer: Peer | undefined = undefined
  #canElicit = false

  constructor(served: Served) {
    this.#served = served
    this.#sessions = new Sessions(served)
  }

  async answer({ method, params }: { method: string; params: unknown }): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.#initialize(params)
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: toolsOf(this.#served) }
      case 'tools/call':
        return this.#toolCall(params)
      case 'resources/list':
        return this.#resources()
      case 'resources/templates/list':
        return { resourceTemplates: [] }
      case 'resources/read':
        return this.#read(params)
      default:
        break
    }
    throw new RpcError({ code: METHOD_NOT_FOUND, message: `no method ${method}` })
  }

  async run(peer: Peer): Promise<void> {
    this.#peer = peer
    await peer.closed
    this.#sessions.close()
  }

  #initialize(params: unknown): Json {
    const { capabilities, protocolVersion: asked } = recordOf(params)
    this.#canElicit = isPlainObject(recordOf(capabilities)['elicitation'])
    return {
      protocolVersion: typeof asked === 'string' ? asked : PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: serverNameOf(this.#served.plugin), version: this.#served.version },
    }
  }

  async #elicit(ask: string): Promise<Answer | undefined> {
    if (this.#peer === undefined || !this.#canElicit) return undefined
    try {
      const result = await this.#peer.request({
        method: 'elicitation/create',
        params: { message: `${this.#served.plugin}: ${ask}`, requestedSchema: ASK_SCHEMA },
      })
      return answerOf(result)
    } catch {
      return undefined
    }
  }

  async #acted({ live, event }: { live: Live; event: HookEvent }): Promise<Acted> {
    const { runtime } = live
    if (runtime === undefined) return NOTHING
    switch (event.event) {
      case 'Stop':
        runtime.endTurn()
        return NOTHING
      case 'PreToolUse': {
        const decided = await decide({
          verdict: await runtime.verdictOn(event),
          canAsk: event.canAsk,
          elicit: async (ask) => this.#elicit(ask),
        })
        if (decided.note !== undefined) live.state.notes.push(decided.note)
        return { ...NOTHING, decision: decided.decision }
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

  async #hook(args: unknown): Promise<Json> {
    const event = parseHook(args)
    const live = await this.#sessions.open({ id: event.session, cwd: event.cwd })
    const { decision, followup } = await this.#acted({ live, event })
    const delivered = withFollowup({ delivered: drained({ live, event: event.event }), followup })
    return hookOutputOf({ event: event.event, delivered, decision })
  }

  async #statusLine(params: unknown): Promise<string> {
    const thread = threadOf(params)
    if (thread === undefined) return JSON.stringify(null)
    const { id, cwd } = thread
    // A thread the hooks haven't reached yet, as before its first turn, mounts here.
    const live =
      this.#sessions.known(id) ??
      (cwd === undefined ? undefined : await this.#sessions.open({ id, cwd }))
    return JSON.stringify(statusLineOf(live?.runtime?.statusLine() ?? []))
  }

  async #toolCall(params: unknown): Promise<unknown> {
    const { name, arguments: args } = recordOf(params)
    if (name === HOOK_TOOL) {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await this.#hook(args)) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: messageOf(error) }] }
      }
    }
    if (name === STATUSLINE_TOOL && this.#served.hasStatus) {
      return {
        content: [{ type: 'text', text: `The status line is ${statusUri(this.#served.plugin)}.` }],
      }
    }
    throw new RpcError({ code: INVALID_PARAMS, message: `no tool ${String(name)}` })
  }

  async #read(params: unknown): Promise<unknown> {
    const { uri } = recordOf(params)
    if (!this.#served.hasStatus || uri !== statusUri(this.#served.plugin)) {
      throw new RpcError({ code: INVALID_PARAMS, message: `no resource ${String(uri)}` })
    }
    const text = await this.#statusLine(params)
    return { contents: [{ uri, mimeType: 'application/json', text }] }
  }

  #resources(): unknown {
    if (!this.#served.hasStatus) return { resources: [] }
    const uri = statusUri(this.#served.plugin)
    return { resources: [{ name: 'statusline', uri, mimeType: 'application/json' }] }
  }
}

export async function serve(served: Served): Promise<void> {
  const server = new Server(served)
  const peer = peerOn({
    input: process.stdin,
    output: process.stdout,
    onRequest: async (call) => server.answer(call),
  })
  return server.run(peer)
}
