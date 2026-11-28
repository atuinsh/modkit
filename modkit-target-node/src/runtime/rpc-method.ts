import * as v from 'valibot'

import { INTERNAL_ERROR, INVALID_PARAMS, RpcError } from './errors'

/** Typed JSON-RPC 2.0 method descriptor coupling its wire name, params schema, and result schema. */
export class RpcMethod<Params, Result> {
  readonly #name: string
  readonly #params: v.GenericSchema<unknown, Params>
  readonly #result: v.GenericSchema<unknown, Result>

  private constructor({
    name,
    params,
    result,
  }: {
    name: string
    params: v.GenericSchema<unknown, Params>
    result: v.GenericSchema<unknown, Result>
  }) {
    this.#name = name
    this.#params = params
    this.#result = result
  }

  static define<Params, Result>(spec: {
    readonly name: string
    readonly params: v.GenericSchema<unknown, Params>
    readonly result: v.GenericSchema<unknown, Result>
  }): RpcMethod<Params, Result> {
    return new RpcMethod(spec)
  }

  get name(): string {
    return this.#name
  }

  /** Validate incoming request params or throw {@link RpcError} with `INVALID_PARAMS`. */
  parseParams(raw: unknown): Params {
    const parsed = v.safeParse(this.#params, raw)
    if (parsed.success) return parsed.output
    const [issue] = parsed.issues
    const path = v.getDotPath(issue)
    const where = path === null ? this.#name : `${this.#name}.${path}`
    throw new RpcError({ code: INVALID_PARAMS, message: `${where}: ${issue.message}` })
  }

  /** Validate a peer's response payload or throw {@link RpcError} with `INTERNAL_ERROR`. */
  parseResult(raw: unknown): Result {
    const parsed = v.safeParse(this.#result, raw)
    if (parsed.success) return parsed.output
    const [issue] = parsed.issues
    throw new RpcError({
      code: INTERNAL_ERROR,
      message: `${this.#name} returned invalid result: ${issue.message}`,
    })
  }
}
