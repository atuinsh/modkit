import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'

import * as v from 'valibot'

import {
  errorMessage,
  McpResponse,
  type McpCall,
  type McpResult,
  type Result,
} from '@atuin/modkit-target/host'

import { RpcPeer, type Peer } from './rpc.ts'

const PROTOCOL_VERSION = '2025-06-18'
const START_TIMEOUT_S = 30
const CALL_TIMEOUT_S = 120
const START_TIMEOUT = Temporal.Duration.from({ seconds: START_TIMEOUT_S })
const CALL_TIMEOUT = Temporal.Duration.from({ seconds: CALL_TIMEOUT_S })

/** Valibot schema for an optional list of strings, falling back to `[]`. */
export const StringListSchema: v.GenericSchema<unknown, string[]> = v.fallback(
  v.array(v.string()),
  [],
)

/** Valibot schema for a string-only env var map, dropping non-string values and falling back to `{}`. */
export const StringEnvSchema: v.GenericSchema<unknown, Record<string, string>> = v.fallback(
  v.pipe(
    v.record(v.string(), v.unknown()),
    v.transform((env) =>
      Object.fromEntries(
        Object.entries(env).flatMap(([key, value]) =>
          typeof value === 'string' ? [[key, value]] : [],
        ),
      ),
    ),
  ),
  {},
)

export interface StdioServer {
  command: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
  cwd: string | undefined
}

interface Connection extends Disposable {
  peer: Peer
  child: ChildProcess
}

async function spawnServer({
  name,
  server,
  signal,
}: {
  name: string
  server: StdioServer
  signal: AbortSignal
}): Promise<ChildProcess> {
  if (signal.aborted) throw new Error('the session ended')
  const child = spawn(server.command, [...server.args], {
    cwd: server.cwd,
    env: { ...process.env, ...server.env },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  // Absorb any late `error` event if `once` detaches its listener on abort before spawn settles.
  child.on('error', () => undefined)
  try {
    await once(child, 'spawn', { signal })
    return child
  } catch (error) {
    child.kill()
    throw new Error(`couldn't start ${name}: ${errorMessage(error)}`, { cause: error })
  }
}

async function connect({
  name,
  server,
  signal,
}: {
  name: string
  server: StdioServer
  signal: AbortSignal
}): Promise<Connection> {
  const child = await spawnServer({ name, server, signal })
  if (child.stdout === null || child.stdin === null) {
    child.kill()
    throw new Error(`couldn't pipe stdio for ${name}`)
  }
  const peer = RpcPeer.on({ input: child.stdout, output: child.stdin })
  const initialized = peer.request({
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'modkit', version: '0' },
    },
    timeout: { duration: START_TIMEOUT, what: `starting ${name}` },
    signal,
  })
  try {
    await initialized
  } catch (error) {
    // A server that started and never answered is still running, and nothing else holds it.
    peer[Symbol.dispose]()
    child.kill()
    throw error
  }
  peer.notify({ method: 'notifications/initialized' })
  return {
    peer,
    child,
    [Symbol.dispose]: () => {
      peer[Symbol.dispose]()
      child.kill()
    },
  }
}

export class Servers implements Disposable {
  readonly #connections = new Map<string, Promise<Connection>>()
  readonly #abort = new AbortController()
  readonly #find: (name: string) => Promise<Result<StdioServer, string>>
  readonly #own: string | undefined

  constructor({
    find,
    own,
  }: {
    find: (name: string) => Promise<Result<StdioServer, string>>
    own?: string
  }) {
    this.#find = find
    this.#own = own
  }

  async call({ server, tool, input }: McpCall): Promise<McpResult> {
    if (server === this.#own) return { isOk: false, reason: `${server} is this mod's own server` }
    if (this.#abort.signal.aborted) return { isOk: false, reason: 'the session ended' }
    try {
      const { peer } = await this.#connection(server)
      const result = await peer.request({
        method: 'tools/call',
        params: { name: tool, arguments: input ?? {} },
        timeout: { duration: CALL_TIMEOUT, what: `${server}'s ${tool}` },
        signal: this.#abort.signal,
      })
      return McpResponse.parse(result).toResult()
    } catch (error) {
      return { isOk: false, reason: errorMessage(error) }
    }
  }

  [Symbol.dispose](): void {
    // Abort first so in-flight calls reject immediately and no new server starts after this pass.
    this.#abort.abort()
    for (const connecting of this.#connections.values()) void Servers.#disposeConnection(connecting)
    this.#connections.clear()
  }

  static async #disposeConnection(connecting: Promise<Connection>): Promise<void> {
    try {
      const connection = await connecting
      connection[Symbol.dispose]()
    } catch {
      // A server that never started has nothing to dispose.
    }
  }

  async #connection(name: string): Promise<Connection> {
    const existing = this.#connections.get(name)
    if (existing !== undefined) return existing
    const connecting = this.#connected(name)
    this.#connections.set(name, connecting)
    void this.#forgotten({ name, connecting })
    return connecting
  }

  async #connected(name: string): Promise<Connection> {
    const found = await this.#find(name)
    const { outcome } = found
    if (!outcome.isOk) throw new Error(outcome.error)
    const connection = await connect({ name, server: outcome.value, signal: this.#abort.signal })
    if (this.#abort.signal.aborted) {
      connection[Symbol.dispose]()
      throw new Error('the session ended')
    }
    return connection
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
