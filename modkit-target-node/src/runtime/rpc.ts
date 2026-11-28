import { once } from 'node:events'
import { createInterface, type Interface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'

import { asRecord, errorMessage } from '@atuin/modkit-target/host'

import { INTERNAL_ERROR, METHOD_NOT_FOUND, RpcError } from './errors.ts'
import type { RpcMethod } from './rpc-method.ts'

interface Call {
  method: string
  params?: unknown
}

const MS_PER_SECOND = 1000

interface Timeout {
  ms: number
  what: string
}

interface Request extends Call {
  // How long to wait for the answer, and what to call the wait when it runs out.
  timeout?: Timeout
}

export interface Peer {
  request: (call: Request) => Promise<unknown>
  call: <Params, Result>(
    method: RpcMethod<Params, Result>,
    options: { readonly params: Params; readonly timeout?: Timeout },
  ) => Promise<Result>
  notify: (call: Call) => void
  readonly closed: Promise<void>
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

type Json = Readonly<Record<string, unknown>>

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

const formatWireError = (error: unknown): { code: number; message: string } =>
  error instanceof RpcError
    ? { code: error.code, message: error.message }
    : { code: INTERNAL_ERROR, message: errorMessage(error) }

function parseWireError(error: unknown): RpcError {
  const { code, message } = asRecord(error)
  return new RpcError({
    code: typeof code === 'number' ? code : INTERNAL_ERROR,
    message: typeof message === 'string' ? message : 'the peer answered an error',
  })
}

export interface Handlers {
  onRequest?: (call: { method: string; params: unknown }) => Promise<unknown>
  onNotify?: (call: { method: string; params: unknown }) => void
}

class LinePeer implements Peer {
  readonly closed: Promise<void>
  readonly #output: Writable
  readonly #handlers: Handlers
  readonly #lines: Interface
  readonly #pending = new Map<number, Pending>()
  #nextId = 1
  #isClosed = false

  constructor({
    input,
    output,
    handlers,
  }: {
    input: Readable
    output: Writable
    handlers: Handlers
  }) {
    this.#output = output
    this.#handlers = handlers
    this.#lines = createInterface({ input })
    this.#lines.on('line', (line) => {
      this.#receive(parseLine(line))
    })
    // A write to a side that has gone, as a pipe to a process that exited, closes the peer too.
    output.on('error', () => {
      this.#lines.close()
    })
    this.closed = this.#untilClosed()
  }

  async call<Params, Result>(
    method: RpcMethod<Params, Result>,
    { params, timeout }: { readonly params: Params; readonly timeout?: Timeout },
  ): Promise<Result> {
    const raw = await this.request({
      method: method.name,
      params,
      ...(timeout !== undefined && { timeout }),
    })
    return method.parseResult(raw)
  }

  async request({ method, params, timeout }: Request): Promise<unknown> {
    if (this.#isClosed) throw new Error('the peer closed')
    const id = this.#nextId
    this.#nextId += 1
    // oxlint-disable-next-line promise/avoid-new -- settled when the answer's line arrives, which nothing awaitable carries
    const answered = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#send({ id, method, ...(params !== undefined && { params }) })
    })
    if (timeout === undefined) return answered
    const timer = new AbortController()
    const late = async (): Promise<never> => {
      await sleep(timeout.ms, undefined, { signal: timer.signal })
      throw new Error(`${timeout.what} took longer than ${timeout.ms / MS_PER_SECOND}s`)
    }
    try {
      return await Promise.race([answered, late()])
    } finally {
      timer.abort()
      // An answer that comes after the wait ran out finds no one waiting.
      this.#pending.delete(id)
    }
  }

  notify({ method, params }: Call): void {
    this.#send({ method, ...(params !== undefined && { params }) })
  }

  async #untilClosed(): Promise<void> {
    await once(this.#lines, 'close')
    this.#isClosed = true
    for (const waiting of this.#pending.values()) waiting.reject(new Error('the peer closed'))
    this.#pending.clear()
  }

  #send(message: Json): void {
    if (!this.#isClosed) this.#output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  }

  #receive(message: unknown): void {
    const record = asRecord(message)
    if (Object.keys(record).length === 0) return
    const { method, id, params } = record
    if (typeof method !== 'string') {
      this.#settle(record)
      return
    }
    if (id === undefined) {
      this.#handlers.onNotify?.({ method, params })
      return
    }
    void this.#answer({ id, method, params })
  }

  async #answer({
    id,
    method,
    params,
  }: {
    id: unknown
    method: string
    params: unknown
  }): Promise<void> {
    const { onRequest } = this.#handlers
    try {
      if (onRequest === undefined) {
        throw new RpcError({ code: METHOD_NOT_FOUND, message: `no method ${method}` })
      }
      this.#send({ id, result: await onRequest({ method, params }) })
    } catch (error) {
      this.#send({ id, error: formatWireError(error) })
    }
  }

  #settle(message: Json): void {
    const { id, error, result } = message
    if (typeof id !== 'number') return
    const waiting = this.#pending.get(id)
    if (waiting === undefined) return
    this.#pending.delete(id)
    if (error === undefined) waiting.resolve(result)
    else waiting.reject(parseWireError(error))
  }
}

export function peerOn({
  input,
  output,
  ...handlers
}: { input: Readable; output: Writable } & Handlers): Peer {
  return new LinePeer({ input, output, handlers })
}
