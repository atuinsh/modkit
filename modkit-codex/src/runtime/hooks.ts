import { isPlainObject } from 'es-toolkit/predicate'

import type {
  Followup,
  ShellCall,
  ShellResult,
  ToolCall,
  ToolResult,
} from '@atuin/modkit-target/host'

import { carriesContext, type HookEvent, type HookEventName } from '../protocol'

function commandOf(input: unknown): string | undefined {
  const command: unknown = isPlainObject(input) ? input['command'] : undefined
  return typeof command === 'string' ? command : undefined
}

const argumentsOf = (input: unknown): Readonly<Record<string, unknown>> =>
  isPlainObject(input) ? input : {}

function outputOf(response: unknown): string {
  if (typeof response === 'string') return response
  return response === undefined ? '' : JSON.stringify(response)
}

export function shellCallOf(event: HookEvent & { event: 'PreToolUse' }): ShellCall | undefined {
  const command = commandOf(event.input)
  return command === undefined ? undefined : { id: event.toolUseId, command, cwd: event.cwd }
}

export const toolCallOf = (event: HookEvent & { event: 'PreToolUse' }): ToolCall => ({
  id: event.toolUseId,
  tool: event.tool,
  input: argumentsOf(event.input),
  cwd: event.cwd,
})

export interface Exit {
  exitCode: number | null
  failed: boolean
}

export function shellResultOf({
  event,
  exit,
}: {
  event: HookEvent & { event: 'PostToolUse' }
  exit: Exit
}): ShellResult | undefined {
  const command = commandOf(event.input)
  if (command === undefined) return undefined
  return { id: event.toolUseId, command, cwd: event.cwd, output: outputOf(event.response), ...exit }
}

export const toolResultOf = ({
  event,
  exit,
}: {
  event: HookEvent & { event: 'PostToolUse' }
  exit: Exit
}): ToolResult => ({
  id: event.toolUseId,
  tool: event.tool,
  input: argumentsOf(event.input),
  cwd: event.cwd,
  output: outputOf(event.response),
  failed: exit.failed,
})

export interface Delivered {
  notes: readonly string[]
  context: readonly string[]
}

export const withFollowup = ({
  delivered,
  followup,
}: {
  delivered: Delivered
  followup: Followup
}): Delivered => ({
  notes: [...delivered.notes, ...(followup.note === undefined ? [] : [followup.note])],
  context: [...delivered.context, ...(followup.context === undefined ? [] : [followup.context])],
})

export type Decision = { kind: 'none' } | { kind: 'deny'; reason: string }

export function hookOutputOf({
  event,
  delivered,
  decision,
}: {
  event: HookEventName
  delivered: Delivered
  decision: Decision
}): Readonly<Record<string, unknown>> {
  const note = delivered.notes.join('\n\n')
  const context = carriesContext(event) ? delivered.context.join('\n\n') : ''
  const specific = {
    ...(context !== '' && { additionalContext: context }),
    ...(decision.kind === 'deny' && {
      permissionDecision: 'deny',
      permissionDecisionReason: decision.reason,
    }),
  }
  return {
    ...(note !== '' && { systemMessage: note }),
    ...(Object.keys(specific).length > 0 && {
      hookSpecificOutput: { hookEventName: event, ...specific },
    }),
  }
}
