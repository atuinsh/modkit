import * as v from 'valibot'

export const HOOK_TOOL = 'hook'
export const STATUSLINE_TOOL = 'statusline'
export const SHELL_TOOL = 'Bash'

export const serverNameOf = (plugin: string): string => `${plugin}-mod`

// Long enough for the user to read and answer an elicitation prompt before Codex aborts the hook.
const ASKING_TIMEOUT_S = 600

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'

interface BaseHook {
  session: string
  cwd: string
}

export type HookEvent =
  | (BaseHook & { event: 'SessionStart' | 'UserPromptSubmit' | 'Stop' })
  | (BaseHook & {
      event: 'PreToolUse'
      tool: string
      input: unknown
      toolUseId: string
      canAsk: boolean
    })
  | (BaseHook & {
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

interface HookSpec {
  readonly fields: Readonly<Record<string, unknown>>
  readonly carriesContext: boolean
  readonly timeoutS?: number
}

const HOOKS = {
  SessionStart: { fields: SESSION, carriesContext: true },
  UserPromptSubmit: { fields: SESSION, carriesContext: true },
  PreToolUse: {
    fields: { ...TOOL, permission_mode: v.optional(v.unknown()) },
    carriesContext: true,
    timeoutS: ASKING_TIMEOUT_S,
  },
  PostToolUse: {
    fields: {
      ...TOOL,
      tool_response: v.optional(v.unknown()),
      transcript_path: v.optional(v.unknown()),
    },
    carriesContext: true,
  },
  Stop: { fields: SESSION, carriesContext: false },
} as const satisfies Readonly<Record<HookEventName, HookSpec>>

const HookSchema = v.variant('event', [
  v.object({ event: v.literal('SessionStart'), ...HOOKS.SessionStart.fields }),
  v.object({ event: v.literal('UserPromptSubmit'), ...HOOKS.UserPromptSubmit.fields }),
  v.object({ event: v.literal('PreToolUse'), ...HOOKS.PreToolUse.fields }),
  v.object({ event: v.literal('PostToolUse'), ...HOOKS.PostToolUse.fields }),
  v.object({ event: v.literal('Stop'), ...HOOKS.Stop.fields }),
])

export const carriesContext = (event: HookEventName): boolean => HOOKS[event].carriesContext

export const hookTimeoutOf = (event: HookEventName): number | undefined => {
  const spec: HookSpec = HOOKS[event]
  return spec.timeoutS
}

/** Build the `${field}` input map for a Codex hook from its wire schema. */
export const hookInputOf = (event: HookEventName): Readonly<Record<string, string>> => ({
  event,
  ...Object.fromEntries(
    Object.keys(HOOKS[event].fields).map((name): readonly [string, string] => [
      name,
      `\${${name}}`,
    ]),
  ),
})

/** Parse and normalize raw MCP hook tool arguments into a typed {@link HookEvent}. */
export function parseHook(args: unknown): HookEvent {
  const parsed = v.safeParse(HookSchema, args)
  if (!parsed.success) {
    const [issue] = parsed.issues
    throw new TypeError(`a hook's ${v.getDotPath(issue) ?? 'arguments'}: ${issue.message}`)
  }
  const { output } = parsed
  const base = { session: output.session_id, cwd: output.cwd }
  if (output.event !== 'PreToolUse' && output.event !== 'PostToolUse') {
    return { ...base, event: output.event }
  }
  const call = { tool: output.tool_name, input: output.tool_input, toolUseId: output.tool_use_id }
  if (output.event === 'PreToolUse') {
    return {
      ...base,
      ...call,
      event: output.event,
      canAsk: output.permission_mode !== 'bypassPermissions',
    }
  }
  const { transcript_path: path, tool_response: response } = output
  const transcript = typeof path === 'string' && path !== '' ? path : null
  return { ...base, ...call, event: output.event, response, transcript }
}
