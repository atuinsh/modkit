import * as v from 'valibot'

import {
  asRecord,
  HarnessTools,
  NATIVE,
  type Capabilities,
  type DroppedSupport,
  type Followup,
  type HookedCall,
  type HookedResult,
  type LoweredSupport,
  type NativeSupport,
} from '@atuin/modkit-target/host'

export const HOOK_TOOL = 'hook'
export const STATUSLINE_TOOL = 'statusline'

export interface CodexCapabilities extends Capabilities {
  readonly status: LoweredSupport
  readonly commands: DroppedSupport
  readonly panes: DroppedSupport
  readonly beforeShell: NativeSupport
  readonly afterShell: NativeSupport
  readonly beforeTool: NativeSupport
  readonly afterTool: NativeSupport
  readonly toolCards: DroppedSupport
}

export const CODEX_CAPABILITIES: CodexCapabilities = {
  status: {
    kind: 'lowered',
    why: "Codex's status line draws buttons and links as text, which can't be pressed or opened",
  },
  commands: {
    kind: 'dropped',
    why: "Codex answers a slash command with a prompt, never with a mod's code",
  },
  panes: { kind: 'dropped', why: 'Codex draws no panes' },
  beforeShell: NATIVE,
  afterShell: NATIVE,
  beforeTool: NATIVE,
  afterTool: NATIVE,
  toolCards: { kind: 'dropped', why: 'Codex draws nothing under a tool call' },
}

export const CODEX_TOOLS: HarnessTools = new HarnessTools({
  harness: 'Codex',
  shell: 'Bash',
  builtin: ['apply_patch', 'spawn_agent', 'write_stdin', 'request_permissions'],
})

// Long enough for the user to read and answer an elicitation prompt before Codex aborts the hook.
const ASKING_TIMEOUT_S = 600
const ASKING_TIMEOUT = Temporal.Duration.from({ seconds: ASKING_TIMEOUT_S })

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'

export interface Exit {
  readonly exitCode: number | null
  readonly failed: boolean
}

export type Decision =
  | { readonly kind: 'none' }
  | { readonly kind: 'deny'; readonly reason: string }

export interface Delivered {
  readonly notes: readonly string[]
  readonly context: readonly string[]
}

export type WireHookOutput = Readonly<Record<string, unknown>>

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
  readonly timeout?: Temporal.Duration
}

const HOOKS = {
  SessionStart: { fields: SESSION, carriesContext: true },
  UserPromptSubmit: { fields: SESSION, carriesContext: true },
  PreToolUse: {
    fields: { ...TOOL, permission_mode: v.optional(v.unknown()) },
    carriesContext: true,
    timeout: ASKING_TIMEOUT,
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

type WireHookEvent = v.InferOutput<typeof HookSchema>

export const hookTimeout = (event: HookEventName): Temporal.Duration | undefined => {
  const spec: HookSpec = HOOKS[event]
  return spec.timeout
}

/** Build the `${field}` input map for a Codex hook from its wire schema. */
export const hookInputTemplate = (event: HookEventName): Readonly<Record<string, string>> => ({
  event,
  ...Object.fromEntries(
    Object.keys(HOOKS[event].fields).map((name): readonly [string, string] => [
      name,
      `\${${name}}`,
    ]),
  ),
})

function extractCommand(input: unknown): string | undefined {
  const { command } = asRecord(input)
  return typeof command === 'string' ? command : undefined
}

function stringifyResponse(response: unknown): string {
  if (typeof response === 'string') return response
  return response === undefined ? '' : JSON.stringify(response)
}

/** Validated Codex hook event with bound domain conversion and wire-reply serialization. */
export class CodexHookEvent {
  readonly #wire: WireHookEvent

  private constructor(wire: WireHookEvent) {
    this.#wire = wire
  }

  /** Parse raw MCP hook tool arguments into a typed {@link CodexHookEvent}. */
  static parse(args: unknown): CodexHookEvent {
    const parsed = v.safeParse(HookSchema, args)
    if (!parsed.success) {
      const [issue] = parsed.issues
      throw new TypeError(`a hook's ${v.getDotPath(issue) ?? 'arguments'}: ${issue.message}`)
    }
    return new CodexHookEvent(parsed.output)
  }

  get kind(): HookEventName {
    return this.#wire.event
  }

  get sessionId(): string {
    return this.#wire.session_id
  }

  get cwd(): string {
    return this.#wire.cwd
  }

  get carriesContext(): boolean {
    return HOOKS[this.#wire.event].carriesContext
  }

  get canAsk(): boolean {
    return this.#wire.event === 'PreToolUse' && this.#wire.permission_mode !== 'bypassPermissions'
  }

  get isShellTool(): boolean {
    return (
      (this.#wire.event === 'PreToolUse' || this.#wire.event === 'PostToolUse') &&
      CODEX_TOOLS.isShell(this.#wire.tool_name)
    )
  }

  get toolUseId(): string | undefined {
    return this.#wire.event === 'PreToolUse' || this.#wire.event === 'PostToolUse'
      ? this.#wire.tool_use_id
      : undefined
  }

  get transcriptPath(): string | null {
    if (this.#wire.event !== 'PostToolUse') return null
    const path = this.#wire.transcript_path
    return typeof path === 'string' && path !== '' ? path : null
  }

  /** Convert a `PreToolUse` event into a modkit {@link HookedCall}. */
  toCall(): HookedCall | undefined {
    if (this.#wire.event !== 'PreToolUse') return undefined
    const { tool_name: tool, tool_use_id: id, tool_input: input, cwd } = this.#wire
    if (!CODEX_TOOLS.isShell(tool)) {
      return { kind: 'tool', id, tool: CODEX_TOOLS.toModTool(tool), input: asRecord(input), cwd }
    }
    const command = extractCommand(input)
    return command === undefined ? undefined : { kind: 'shell', id, command, cwd }
  }

  /** Convert a `PostToolUse` event and resolved shell exit into a modkit {@link HookedResult}. */
  toResult(exit: Exit): HookedResult | undefined {
    if (this.#wire.event !== 'PostToolUse') return undefined
    const { tool_name: tool, tool_use_id: id, tool_input: input, cwd, tool_response } = this.#wire
    const output = stringifyResponse(tool_response)
    if (!CODEX_TOOLS.isShell(tool)) {
      return {
        kind: 'tool',
        id,
        tool: CODEX_TOOLS.toModTool(tool),
        input: asRecord(input),
        cwd,
        output,
        failed: exit.failed,
      }
    }
    const command = extractCommand(input)
    return command === undefined ? undefined : { kind: 'shell', id, command, cwd, output, ...exit }
  }

  /** Format the Codex hook JSON response carrying buffered notes, context, followup, and decision. */
  reply({
    delivered,
    followup,
    decision,
  }: {
    delivered: Delivered
    followup: Followup
    decision: Decision
  }): WireHookOutput {
    const notes = [...delivered.notes, ...(followup.note === undefined ? [] : [followup.note])]
    const contexts = [
      ...delivered.context,
      ...(followup.context === undefined ? [] : [followup.context]),
    ]
    const note = notes.join('\n\n')
    const context = this.carriesContext ? contexts.join('\n\n') : ''
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
        hookSpecificOutput: { hookEventName: this.#wire.event, ...specific },
      }),
    }
  }
}
