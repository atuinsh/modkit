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

import { peerOn, type Peer } from './rpc'

const PROTOCOL_VERSION = '2025-06-18'
const START_MS = 30_000
const CALL_MS = 120_000

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
    throw new Error(`couldn't start ${name}: ${errorMessage(error)}`, { cause: error })
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

export class Servers implements Disposable {
  readonly #connections = new Map<string, Promise<Connection>>()
  readonly #find: (name: string) => Promise<Result<StdioServer, string>>
  readonly #own: string | undefined
  #isClosed = false

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
    if (this.#isClosed) return { isOk: false, reason: 'the session ended' }
    try {
      const { peer } = await this.#connection(server)
      const result = await peer.request({
        method: 'tools/call',
        params: { name: tool, arguments: input ?? {} },
        timeout: { ms: CALL_MS, what: `${server}'s ${tool}` },
      })
      return McpResponse.parse(result).toResult()
    } catch (error) {
      return { isOk: false, reason: errorMessage(error) }
    }
  }

  close(): void {
    // Set first, so a call still under way starts no server after this pass.
    this.#isClosed = true
    for (const connecting of this.#connections.values()) void Servers.#killed(connecting)
    this.#connections.clear()
  }

  [Symbol.dispose](): void {
    this.close()
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
    const found = await this.#find(name)
    const { outcome } = found
    if (!outcome.isOk) throw new Error(outcome.error)
    return connect({ name, server: outcome.value })
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
