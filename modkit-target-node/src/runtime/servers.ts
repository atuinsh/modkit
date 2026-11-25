import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'

import { isPlainObject } from 'es-toolkit/predicate'

import type { McpCall, McpResult } from '@atuin/modkit-target/host'

import { peerOn, type Peer } from './rpc'

const PROTOCOL_VERSION = '2025-06-18'
const START_MS = 30_000
const CALL_MS = 120_000
const MS_PER_SECOND = 1000

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

async function within<T>({
  promise,
  ms,
  what,
}: {
  promise: Promise<T>
  ms: number
  what: string
}): Promise<T> {
  const timer = new AbortController()
  const late = async (): Promise<never> => {
    await sleep(ms, undefined, { signal: timer.signal })
    throw new Error(`${what} took longer than ${ms / MS_PER_SECOND}s`)
  }
  try {
    return await Promise.race([promise, late()])
  } finally {
    timer.abort()
  }
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
  })
  await within({ promise: initialized, ms: START_MS, what: `starting ${name}` })
  peer.notify({ method: 'notifications/initialized' })
  return { peer, child }
}

export class Servers {
  readonly #connections = new Map<string, Promise<Connection>>()
  readonly #find: (name: string) => Promise<StdioServer | Unreachable>
  readonly #own: string | undefined

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
    try {
      const { peer } = await this.#connection(server)
      const result = await within({
        promise: peer.request({
          method: 'tools/call',
          params: { name: tool, arguments: input ?? {} },
        }),
        ms: CALL_MS,
        what: `${server}'s ${tool}`,
      })
      return mcpResultOf(result)
    } catch (error) {
      return { isOk: false, reason: messageOf(error) }
    }
  }

  close(): void {
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
