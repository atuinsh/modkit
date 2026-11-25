export class RpcError extends Error {
  readonly code: number

  constructor({ code, message }: { code: number; message: string }) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

export const METHOD_NOT_FOUND = -32_601
export const INVALID_PARAMS = -32_602
export const INTERNAL_ERROR = -32_603
