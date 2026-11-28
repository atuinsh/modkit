import { once } from 'node:events'
import { createInterface, type Interface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import { asRecord, errorMessage } from '@atuin/modkit-target/host'

import { INTERNAL_ERROR, METHOD_NOT_FOUND, RpcError } from './errors.ts'
import type { RpcMethod } from './rpc-method.ts'

interface Call {
  method: string
  params?: unknown
}

interface Timeout {
  duration: Temporal.Duration
  what: string
}

interface Request extends Call {
  // How long to wait for the answer, and what to call the wait when it runs out.
  timeout?: Timeout
  signal?: AbortSignal
}

export interface Peer extends Disposable {
  request: (call: Request) => Promise<unknown>
  call: <Params, Result>(
    method: RpcMethod<Params, Result>,
    options: { readonly params: Params; readonly timeout?: Timeout; readonly signal?: AbortSignal },
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

function abortReason({
  signal,
  timed,
  timeout,
}: {
  signal: AbortSignal | undefined
  timed: AbortSignal | undefined
  timeout: Timeout | undefined
}): Error {
  if (timed?.aborted === true && timeout !== undefined) {
    return new Error(`${timeout.what} took longer than ${timeout.duration.total('second')}s`)
  }
  const reason: unknown = signal?.reason
  return Error.isError(reason) ? reason : new Error('the request was aborted')
}

function combineAbort({
  signal,
  timeout,
}: {
  signal: AbortSignal | undefined
  timeout: Timeout | undefined
}): { combined: AbortSignal | undefined; reason: () => Error } {
  const timed =
    timeout === undefined ? undefined : AbortSignal.timeout(timeout.duration.total('millisecond'))
  const combined =
    signal !== undefined && timed !== undefined
      ? AbortSignal.any([signal, timed])
      : (signal ?? timed)
  return { combined, reason: () => abortReason({ signal, timed, timeout }) }
}

export interface Handlers {
  onRequest?: (call: { method: string; params: unknown }) => Promise<unknown>
  onNotify?: (call: { method: string; params: unknown }) => void
}

/** Line-delimited JSON-RPC 2.0 peer implementing {@link Peer} and {@link Disposable}. */
export class RpcPeer implements Peer {
  readonly closed: Promise<void>
  readonly #output: Writable
  readonly #handlers: Handlers
  readonly #lines: Interface
  readonly #pending = new Map<number, Pending>()
  #nextId = 1
  #isClosed = false

  private constructor({
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

  /** Attach an {@link RpcPeer} to arbitrary `input`/`output` streams. */
  static on({
    input,
    output,
    ...handlers
  }: { input: Readable; output: Writable } & Handlers): Peer {
    return new RpcPeer({ input, output, handlers })
  }

  /** Attach an {@link RpcPeer} to `process.stdin` and `process.stdout`. */
  static stdio(handlers: Handlers): Peer {
    return new RpcPeer({ input: process.stdin, output: process.stdout, handlers })
  }

  async call<Params, Result>(
    method: RpcMethod<Params, Result>,
    {
      params,
      timeout,
      signal,
    }: { readonly params: Params; readonly timeout?: Timeout; readonly signal?: AbortSignal },
  ): Promise<Result> {
    const raw = await this.request({
      method: method.name,
      params,
      ...(timeout !== undefined && { timeout }),
      ...(signal !== undefined && { signal }),
    })
    return method.parseResult(raw)
  }

  async request({ method, params, timeout, signal }: Request): Promise<unknown> {
    if (this.#isClosed) throw new Error('the peer closed')
    const id = this.#allocateId()
    const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    const { combined, reason } = combineAbort({ signal, timeout })
    const onAbort = (): void => {
      this.#pending.delete(id)
      reject(reason())
    }
    if (combined?.aborted === true) {
      onAbort()
      return promise
    }
    combined?.addEventListener('abort', onAbort, { once: true })
    this.#pending.set(id, { resolve, reject })
    try {
      this.#send({ id, method, ...(params !== undefined && { params }) })
      return await promise
    } finally {
      combined?.removeEventListener('abort', onAbort)
      this.#pending.delete(id)
    }
  }

  notify({ method, params }: Call): void {
    this.#send({ method, ...(params !== undefined && { params }) })
  }

  [Symbol.dispose](): void {
    this.#isClosed = true
    this.#lines.close()
    for (const waiting of this.#pending.values()) waiting.reject(new Error('the peer closed'))
    this.#pending.clear()
  }

  #allocateId(): number {
    const id = this.#nextId
    this.#nextId += 1
    return id
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
