import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'

import { isPlainObject } from 'es-toolkit/predicate'

import type { McpCall, McpResult } from '@atuin/modkit-target/host'

import { peerOn, type Peer } from './rpc'

const PROTOCOL_VERSION = '2025-06-18'
const START_MS = 30_000
const CALL_MS = 120_000

export interface StdioServer {
  command: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
  cwd: string | undefined
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export interface Unreachable {
  reason: string
}

function joinedText(content: unknown): string {
  const blocks: readonly unknown[] = Array.isArray(content) ? content : []
  return blocks
    .flatMap((block) =>
      isPlainObject(block) && block['type'] === 'text' && typeof block['text'] === 'string'
        ? [block['text']]
        : [],
    )
    .join('\n')
}

export function mcpResultOf(result: unknown): McpResult {
  if (!isPlainObject(result)) {
    return { isOk: false, reason: 'the server answered something not MCP' }
  }
  const {
    content,
    isError,
    structuredContent: structured,
  }: Readonly<Record<string, unknown>> = result
  const text = joinedText(content)
  if (isError === true) {
    return { isOk: false, reason: text === '' ? 'the tool reported a failure' : text }
  }
  return { isOk: true, text, ...(structured !== undefined && { structured }) }
}

interface Connection {
  peer: Peer
  child: ChildProcess
}

async function connect({
  name,
  server,
}: {
  name: string
  server: StdioServer
}): Promise<Connection> {
  const child = spawn(server.command, [...server.args], {
    cwd: server.cwd,
    env: { ...process.env, ...server.env },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  try {
    await once(child, 'spawn')
  } catch (error) {
    throw new Error(`couldn't start ${name}: ${messageOf(error)}`, { cause: error })
  }
  const peer = peerOn({ input: child.stdout, output: child.stdin })
  const initialized = peer.request({
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'modkit', version: '0' },
    },
    timeout: { ms: START_MS, what: `starting ${name}` },
  })
  try {
    await initialized
  } catch (error) {
    // A server that started and never answered is still running, and nothing else holds it.
    child.kill()
    throw error
  }
  peer.notify({ method: 'notifications/initialized' })
  return { peer, child }
}

export class Servers {
  readonly #connections = new Map<string, Promise<Connection>>()
  readonly #find: (name: string) => Promise<StdioServer | Unreachable>
  readonly #own: string | undefined
  #isClosed = false

  constructor({
    find,
    own,
  }: {
    find: (name: string) => Promise<StdioServer | Unreachable>
    own?: string
  }) {
    this.#find = find
    this.#own = own
  }

  async call({ server, tool, input }: McpCall): Promise<McpResult> {
    if (server === this.#own) return { isOk: false, reason: `${server} is this mod's own server` }
    if (this.#isClosed) return { isOk: false, reason: 'the session ended' }
    try {
      const { peer } = await this.#connection(server)
      const result = await peer.request({
        method: 'tools/call',
        params: { name: tool, arguments: input ?? {} },
        timeout: { ms: CALL_MS, what: `${server}'s ${tool}` },
      })
      return mcpResultOf(result)
    } catch (error) {
      return { isOk: false, reason: messageOf(error) }
    }
  }

  close(): void {
    // Set first, so a call still under way starts no server after this pass.
    this.#isClosed = true
    for (const connecting of this.#connections.values()) void Servers.#killed(connecting)
    this.#connections.clear()
  }

  static async #killed(connecting: Promise<Connection>): Promise<void> {
    try {
      const { child } = await connecting
      child.kill()
    } catch {
      // A server that never started has nothing to kill.
    }
  }

  async #connection(name: string): Promise<Connection> {
    const known = this.#connections.get(name)
    if (known !== undefined) return known
    const connecting = this.#connected(name)
    this.#connections.set(name, connecting)
    void this.#forgotten({ name, connecting })
    return connecting
  }

  async #connected(name: string): Promise<Connection> {
    const server = await this.#find(name)
    if ('reason' in server) throw new Error(server.reason)
    return connect({ name, server })
  }

  // A server that couldn't be started, or has since gone, is started again on the next call.
  async #forgotten({
    name,
    connecting,
  }: {
    name: string
    connecting: Promise<Connection>
  }): Promise<void> {
    try {
      const { peer } = await connecting
      await peer.closed
    } catch {
      // Forgotten below, as one that closed is.
    }
    if (this.#connections.get(name) === connecting) this.#connections.delete(name)
  }
}
