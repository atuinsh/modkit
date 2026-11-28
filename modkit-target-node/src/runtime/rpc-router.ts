import { METHOD_NOT_FOUND, RpcError } from './errors'
import type { RpcMethod } from './rpc-method'

/** Schema-validating JSON-RPC request router built from {@link RpcMethod} descriptors. */
export class RpcRouter {
  readonly #handlers = new Map<string, (params: unknown) => Promise<unknown>>()

  static create(): RpcRouter {
    return new RpcRouter()
  }

  /** Register a typed handler for `method`; incoming params are validated before `handler` runs. */
  handle<Params, Result>(
    method: RpcMethod<Params, Result>,
    handler: (params: Params) => Promise<Result> | Result,
  ): this {
    this.#handlers.set(method.name, async (raw) => handler(method.parseParams(raw)))
    return this
  }

  /** Dispatch a JSON-RPC request, validating params and rejecting unknown methods. */
  async dispatch({ method, params }: { method: string; params: unknown }): Promise<unknown> {
    const handler = this.#handlers.get(method)
    if (handler === undefined) {
      throw new RpcError({ code: METHOD_NOT_FOUND, message: `no method ${method}` })
    }
    return handler(params)
  }
}
