import { isPlainObject } from 'es-toolkit/predicate'

import {
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  RpcError,
} from '@atuin/modkit-target-node/runtime/errors'
import { peerOn, type Peer } from '@atuin/modkit-target-node/runtime/rpc'
import { asRecord, errorMessage, ModVerdict, type Followup } from '@atuin/modkit-target/host'

import {
  CodexHookEvent,
  HOOK_TOOL,
  STATUSLINE_TOOL,
  type Decision,
  type WireHookOutput,
} from '../protocol'
import { Sessions, type LiveSession, type Served } from './sessions'
import { CodexStatusLine } from './statusline'

export type { Served } from './sessions'

const PROTOCOL_VERSION = '2025-06-18'

const STATUSLINE_STATE = 'com.openai/codex-statusline-state'

const ASK_SCHEMA = {
  type: 'object',
  properties: { run: { type: 'boolean', title: 'Go ahead', default: false } },
  required: ['run'],
} as const

type Json = Readonly<Record<string, unknown>>

function parseConfirmation(result: unknown): boolean | undefined {
  if (!isPlainObject(result)) return undefined
  const { action, content }: Json = result
  if (action !== 'accept' && action !== 'decline' && action !== 'cancel') return undefined
  return action === 'accept' && isPlainObject(content) && content['run'] === true
}

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

// The thread a status line read is for, which Codex names in the request's `_meta`.
function parseThread(params: unknown): { id: string; cwd: string | undefined } | undefined {
  const { thread } = asRecord(asRecord(asRecord(params)['_meta'])[STATUSLINE_STATE])
  const { id, workspace } = asRecord(thread)
  const { cwd } = asRecord(workspace)
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
        return { tools: listTools(this.#served) }
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
    this.#sessions[Symbol.dispose]()
  }

  #initialize(params: unknown): Json {
    const { capabilities, protocolVersion: asked } = asRecord(params)
    this.#canElicit = isPlainObject(asRecord(capabilities)['elicitation'])
    return {
      protocolVersion: typeof asked === 'string' ? asked : PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: `${this.#served.plugin}-mod`, version: this.#served.version },
    }
  }

  async #elicit(ask: string): Promise<boolean | undefined> {
    if (this.#peer === undefined || !this.#canElicit) return undefined
    try {
      const result = await this.#peer.request({
        method: 'elicitation/create',
        params: { message: `${this.#served.plugin}: ${ask}`, requestedSchema: ASK_SCHEMA },
      })
      return parseConfirmation(result)
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

  async #statusLine(params: unknown): Promise<string> {
    const thread = parseThread(params)
    if (thread === undefined) return JSON.stringify(null)
    const { id, cwd } = thread
    // A thread the hooks haven't reached yet, as before its first turn, mounts here.
    const live =
      this.#sessions.known(id) ??
      (cwd === undefined ? undefined : await this.#sessions.open({ id, cwd }))
    return JSON.stringify(CodexStatusLine.render(live?.runtime?.statusLine() ?? []))
  }

  async #toolCall(params: unknown): Promise<unknown> {
    const { name, arguments: args } = asRecord(params)
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
    throw new RpcError({ code: INVALID_PARAMS, message: `no tool ${String(name)}` })
  }

  async #read(params: unknown): Promise<unknown> {
    const { uri } = asRecord(params)
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
