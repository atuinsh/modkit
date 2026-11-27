import { isPlainObject } from 'es-toolkit/predicate'

import type { Followup, HookedCall, HookedResult } from '@atuin/modkit-target/host'

const PI_SHELL = 'bash'
const MOD_SHELL = 'Bash'

export const modToolOf = (piTool: string): string => (piTool === PI_SHELL ? MOD_SHELL : piTool)

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

export function callOf({ event, cwd }: { event: PiCall; cwd: string }): HookedCall {
  const { command } = event.input
  if (event.toolName === PI_SHELL && typeof command === 'string') {
    return { kind: 'shell', id: event.toolCallId, command, cwd }
  }
  return {
    kind: 'tool',
    id: event.toolCallId,
    tool: modToolOf(event.toolName),
    input: event.input,
    cwd,
  }
}

const outputOf = (content: readonly PiBlock[]): string =>
  content
    .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('')

const EXITED = /Command exited with code (?<code>\d+)\s*$/u

const structuredOf = (
  result: Pick<PiResult, 'structuredContent'>,
): Readonly<Record<string, unknown>> =>
  isPlainObject(result.structuredContent) ? result.structuredContent : {}

function exitOf(result: Pick<PiResult, 'content' | 'structuredContent' | 'isError'>): {
  exitCode: number | null
  failed: boolean
} {
  const { exit_code: structured } = structuredOf(result)
  if (typeof structured === 'number') {
    return { exitCode: structured, failed: structured !== 0 || result.isError }
  }
  const code = EXITED.exec(outputOf(result.content))?.groups?.['code']
  if (code !== undefined) return { exitCode: Number(code), failed: true }
  return { exitCode: result.isError ? null : 0, failed: result.isError }
}

function commandOutputOf(result: Pick<PiResult, 'content' | 'structuredContent'>): string {
  const { output: structured } = structuredOf(result)
  if (typeof structured === 'string') return structured
  return outputOf(result.content).replace(EXITED, '').trimEnd()
}

export function resultOf({
  event,
  cwd,
}: {
  event: PiResult
  cwd: string
}): HookedResult | undefined {
  const call = callOf({ event, cwd })
  if (call.kind === 'shell') {
    return { ...call, output: commandOutputOf(event), ...exitOf(event) }
  }
  if (event.toolName === PI_SHELL) return undefined
  return { ...call, output: outputOf(event.content), failed: event.isError }
}

export function followedBy<Part extends PiBlock, Structured>({
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
