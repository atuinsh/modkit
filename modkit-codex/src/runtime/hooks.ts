import { isPlainObject } from 'es-toolkit/predicate'

import type { Followup, HookedCall, HookedResult } from '@atuin/modkit-target/host'

import { carriesContext, SHELL_TOOL, type HookEvent, type HookEventName } from '../protocol'

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

export function callOf(event: HookEvent & { event: 'PreToolUse' }): HookedCall | undefined {
  if (event.tool !== SHELL_TOOL) {
    return {
      kind: 'tool',
      id: event.toolUseId,
      tool: event.tool,
      input: argumentsOf(event.input),
      cwd: event.cwd,
    }
  }
  const command = commandOf(event.input)
  return command === undefined
    ? undefined
    : { kind: 'shell', id: event.toolUseId, command, cwd: event.cwd }
}

export interface Exit {
  exitCode: number | null
  failed: boolean
}

export function resultOf({
  event,
  exit,
}: {
  event: HookEvent & { event: 'PostToolUse' }
  exit: Exit
}): HookedResult | undefined {
  const output = outputOf(event.response)
  if (event.tool !== SHELL_TOOL) {
    return {
      kind: 'tool',
      id: event.toolUseId,
      tool: event.tool,
      input: argumentsOf(event.input),
      cwd: event.cwd,
      output,
      failed: exit.failed,
    }
  }
  const command = commandOf(event.input)
  return command === undefined
    ? undefined
    : { kind: 'shell', id: event.toolUseId, command, cwd: event.cwd, output, ...exit }
}

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
