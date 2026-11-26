import { isPlainObject } from 'es-toolkit/predicate'
import * as v from 'valibot'

import type {
  Followup,
  ShellCall,
  ShellResult,
  ToolCall,
  ToolResult,
} from '@atuin/modkit-target/host'

type HookEventName = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop'

interface Base {
  session: string
  cwd: string
}

export type HookEvent =
  | (Base & { event: 'SessionStart' | 'UserPromptSubmit' | 'Stop' })
  | (Base & {
      event: 'PreToolUse'
      tool: string
      input: unknown
      toolUseId: string
      canAsk: boolean
    })
  | (Base & {
      event: 'PostToolUse'
      tool: string
      input: unknown
      response: unknown
      toolUseId: string
      transcript: string | null
    })

const SESSION = { session_id: v.string(), cwd: v.string() }

const TOOL = {
  ...SESSION,
  tool_name: v.string(),
  tool_input: v.optional(v.unknown()),
  tool_use_id: v.string(),
}

const HookSchema = v.variant('event', [
  v.object({ event: v.picklist(['SessionStart', 'UserPromptSubmit', 'Stop']), ...SESSION }),
  v.object({ event: v.literal('PreToolUse'), ...TOOL, permission_mode: v.optional(v.unknown()) }),
  v.object({
    event: v.literal('PostToolUse'),
    ...TOOL,
    tool_response: v.optional(v.unknown()),
    transcript_path: v.optional(v.unknown()),
  }),
])

function hookOf(args: unknown): v.InferOutput<typeof HookSchema> {
  const parsed = v.safeParse(HookSchema, args)
  if (parsed.success) return parsed.output
  const [issue] = parsed.issues
  throw new TypeError(`a hook's ${v.getDotPath(issue) ?? 'arguments'}: ${issue.message}`)
}

export function hookEventOf(args: unknown): HookEvent {
  const output = hookOf(args)
  const base = { session: output.session_id, cwd: output.cwd }
  if (output.event !== 'PreToolUse' && output.event !== 'PostToolUse') {
    return { ...base, event: output.event }
  }
  const call = { tool: output.tool_name, input: output.tool_input, toolUseId: output.tool_use_id }
  if (output.event === 'PreToolUse') {
    const canAsk = output.permission_mode !== 'bypassPermissions'
    return { ...base, ...call, event: output.event, canAsk }
  }
  const { transcript_path: path, tool_response: response } = output
  const transcript = typeof path === 'string' && path !== '' ? path : null
  return { ...base, ...call, event: output.event, response, transcript }
}

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

const CARRIES_CONTEXT: Readonly<Record<HookEventName, boolean>> = {
  SessionStart: true,
  UserPromptSubmit: true,
  PreToolUse: true,
  PostToolUse: true,
  Stop: false,
}

export const carriesContext = (event: HookEventName): boolean => CARRIES_CONTEXT[event]

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
  const context = CARRIES_CONTEXT[event] ? delivered.context.join('\n\n') : ''
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
