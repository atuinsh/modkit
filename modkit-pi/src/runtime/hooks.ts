import { isPlainObject } from 'es-toolkit/predicate'

import type {
  Followup,
  ShellCall,
  ShellResult,
  ToolCall,
  ToolResult,
  Verdict,
} from '@atuin/modkit-target/host'

export const PI_SHELL = 'bash'
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

export function shellCallOf({ event, cwd }: { event: PiCall; cwd: string }): ShellCall | undefined {
  const { command } = event.input
  if (event.toolName !== PI_SHELL || typeof command !== 'string') return undefined
  return { id: event.toolCallId, command, cwd }
}

export const toolCallOf = ({ event, cwd }: { event: PiCall; cwd: string }): ToolCall => ({
  id: event.toolCallId,
  tool: modToolOf(event.toolName),
  input: event.input,
  cwd,
})

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

export function shellResultOf({
  event,
  cwd,
}: {
  event: PiResult
  cwd: string
}): ShellResult | undefined {
  const call = shellCallOf({ event, cwd })
  if (call === undefined) return undefined
  return { ...call, output: commandOutputOf(event), ...exitOf(event) }
}

export const toolResultOf = ({ event, cwd }: { event: PiResult; cwd: string }): ToolResult => ({
  ...toolCallOf({ event, cwd }),
  output: outputOf(event.content),
  failed: event.isError,
})

const refusedReason = (ask: string): string => `${ask}\n\nThe person said no.`

export async function blockOf({
  verdict,
  canAsk,
  confirm,
  notify,
}: {
  verdict: Verdict
  canAsk: boolean
  confirm: (ask: string) => Promise<boolean>
  notify: (text: string) => void
}): Promise<Block | undefined> {
  if (verdict === undefined) return undefined
  if ('deny' in verdict) return { block: true, reason: verdict.deny }
  if (canAsk) {
    const isAllowed = await confirm(verdict.ask)
    return isAllowed ? undefined : { block: true, reason: refusedReason(verdict.ask) }
  }
  if (verdict.otherwise === 'deny') return { block: true, reason: verdict.ask }
  notify(verdict.ask)
  return undefined
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
