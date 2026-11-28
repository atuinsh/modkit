import {
  asRecord,
  type Followup,
  type HookedCall,
  type HookedResult,
} from '@atuin/modkit-target/host'

import { PI_TOOLS } from '../spec.ts'

export interface PiCall {
  toolName: string
  toolCallId: string
  input: Readonly<Record<string, unknown>>
}

export interface PiBlock {
  type: string
  text?: string
}

export interface PiResult extends PiCall {
  content: readonly PiBlock[]
  structuredContent?: unknown
  isError: boolean
}

export interface Block {
  block: true
  reason: string
}

const outputOf = (content: readonly PiBlock[]): string =>
  content
    .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('')

const EXITED = /Command exited with code (?<code>\d+)\s*$/u

function exitOf(result: Pick<PiResult, 'content' | 'structuredContent' | 'isError'>): {
  exitCode: number | null
  failed: boolean
} {
  const { exit_code: structured } = asRecord(result.structuredContent)
  if (typeof structured === 'number') {
    return { exitCode: structured, failed: structured !== 0 || result.isError }
  }
  const code = EXITED.exec(outputOf(result.content))?.groups?.['code']
  if (code !== undefined) return { exitCode: Number(code), failed: true }
  return { exitCode: result.isError ? null : 0, failed: result.isError }
}

function commandOutputOf(result: Pick<PiResult, 'content' | 'structuredContent'>): string {
  const { output: structured } = asRecord(result.structuredContent)
  if (typeof structured === 'string') return structured
  return outputOf(result.content).replace(EXITED, '').trimEnd()
}

/** Bound translator for pi tool hook events into modkit {@link HookedCall} / {@link HookedResult}. */
export class PiEvent {
  readonly #event: PiCall
  readonly #cwd: string

  private constructor({ event, cwd }: { event: PiCall; cwd: string }) {
    this.#event = event
    this.#cwd = cwd
  }

  /** Bind a pi tool event and working directory for translation. */
  static from({ event, cwd }: { event: PiCall; cwd: string }): PiEvent {
    return new PiEvent({ event, cwd })
  }

  /** Append a mod's {@link Followup.context} to a pi tool result's content blocks. */
  static appendFollowup<Part extends PiBlock, Structured>({
    event,
    followup,
  }: {
    event: { content: readonly Part[]; structuredContent?: Structured }
    followup: Followup
  }):
    | { content: (Part | { type: 'text'; text: string })[]; structuredContent?: Structured }
    | undefined {
    if (followup.context === undefined) return undefined
    const content = [...event.content, { type: 'text' as const, text: `\n\n${followup.context}` }]
    return event.structuredContent === undefined
      ? { content }
      : { content, structuredContent: event.structuredContent }
  }

  /** Translate this pi `tool_call` event into a modkit {@link HookedCall}. */
  toCall(): HookedCall {
    const event = this.#event
    const { command } = event.input
    if (PI_TOOLS.isShell(event.toolName) && typeof command === 'string') {
      return { kind: 'shell', id: event.toolCallId, command, cwd: this.#cwd }
    }
    return {
      kind: 'tool',
      id: event.toolCallId,
      tool: PI_TOOLS.toModTool(event.toolName),
      input: event.input,
      cwd: this.#cwd,
    }
  }

  /** Translate a completed pi `tool_result` event into a modkit {@link HookedResult}. */
  toResult(
    result: Pick<PiResult, 'content' | 'structuredContent' | 'isError'>,
  ): HookedResult | undefined {
    const call = this.toCall()
    if (call.kind === 'shell') {
      return { ...call, output: commandOutputOf(result), ...exitOf(result) }
    }
    if (PI_TOOLS.isShell(this.#event.toolName)) return undefined
    return { ...call, output: outputOf(result.content), failed: result.isError }
  }
}
