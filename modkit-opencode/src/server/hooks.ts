import { asRecord, type HookedCall, type HookedResult } from '@atuin/modkit-target/host'

import { OPENCODE_TOOLS } from '../contract.ts'

export interface OcCall {
  tool: string
  id: string
  input: unknown
}

interface OcBlock {
  type: string
  text?: string
}

export interface OcResult {
  output?: unknown
  content?: readonly OcBlock[] | string
  metadata?: unknown
}

function textOf(content: OcResult['content']): string {
  if (typeof content === 'string') return content
  return (content ?? [])
    .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('\n')
}

/** Bound translator for opencode tool hook events and results. */
export class OpencodeEvent {
  readonly #call: OcCall
  readonly #cwd: string

  private constructor({ call, cwd }: { call: OcCall; cwd: string }) {
    this.#call = call
    this.#cwd = cwd
  }

  static from({ call, cwd }: { call: OcCall; cwd: string }): OpencodeEvent {
    return new OpencodeEvent({ call, cwd })
  }

  /** Append a followup `context` text block to an opencode tool `result`. */
  static withContext<Result extends OcResult>({
    result,
    context,
  }: {
    result: Result
    context: string
  }): Result {
    const blocks: OcBlock[] =
      typeof result.content === 'string'
        ? [{ type: 'text', text: result.content }]
        : [...(result.content ?? [])]
    return { ...result, content: [...blocks, { type: 'text', text: context }] }
  }

  /** Convert this call into a modkit {@link HookedCall}. */
  toCall(): HookedCall {
    const input = asRecord(this.#call.input)
    const { command, workdir } = input
    if (OPENCODE_TOOLS.isShell(this.#call.tool) && typeof command === 'string') {
      return {
        kind: 'shell',
        id: this.#call.id,
        command,
        cwd: typeof workdir === 'string' ? workdir : this.#cwd,
      }
    }
    return {
      kind: 'tool',
      id: this.#call.id,
      tool: OPENCODE_TOOLS.toModTool(this.#call.tool),
      input,
      cwd: this.#cwd,
    }
  }

  /** Convert this call and completed `result` into a modkit {@link HookedResult}. */
  toResult(result: OcResult): HookedResult | undefined {
    const parsed = this.toCall()
    if (parsed.kind === 'tool') {
      return { ...parsed, output: textOf(result.content), failed: false }
    }
    const { status, exit } = asRecord(result.metadata)
    if (status === 'running') return undefined
    const { output: structured } = asRecord(result.output)
    const exitCode = typeof exit === 'number' ? exit : null
    return {
      ...parsed,
      output: typeof structured === 'string' ? structured : textOf(result.content),
      exitCode,
      failed: exitCode !== 0,
    }
  }

  /** Convert this call and error `message` into a failed modkit {@link HookedResult}. */
  toFailedResult(message: string): HookedResult {
    const parsed = this.toCall()
    return parsed.kind === 'shell'
      ? { ...parsed, output: message, exitCode: null, failed: true }
      : { ...parsed, output: message, failed: true }
  }
}
