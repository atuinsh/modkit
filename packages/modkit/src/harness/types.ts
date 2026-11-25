/**
 * Harness capability contracts, hook payloads, and adapter interfaces between a mod and its harness.
 *
 * Mods read {@link Harness} via `useHarness()` and receive event payloads (`ShellCall`, `ToolCall`,
 * `ToolRow`, etc.) in modpart handlers. Harness targets implement {@link HarnessAdapter} and pass it to
 * `mount()`.
 *
 * @module
 */

export interface ShellCall {
  /** Tool call identifier (or a target-derived ID when the harness does not supply one). */
  id: string
  command: string
  cwd: string
}

export interface ShellResult extends ShellCall {
  output: string
  /** Process exit code, or `null` if terminated without one (for example, via signal). */
  exitCode: number | null
  failed: boolean
}

export interface ToolCall {
  /** Tool call identifier (or a target-derived ID when the harness does not supply one). */
  id: string
  /** Harness-specific tool name, such as `'Edit'`, `'EnterWorktree'`, or `'mcp__server__tool'`. */
  tool: string
  /** Tool arguments keyed by the tool's input schema. */
  input: Readonly<Record<string, unknown>>
  cwd: string
}

export interface ToolResult extends ToolCall {
  /** Text output returned by the tool to the model. */
  output: string
  failed: boolean
}

export interface ToolRow {
  /** Tool call identifier, matching the corresponding {@link ToolCall} or {@link ShellCall}. */
  id: string
  /** Harness-specific tool name (including `'Bash'`). */
  tool: string
  /** Tool arguments keyed by the tool's input schema. */
  input: Readonly<Record<string, unknown>>
  isRunning: boolean
  failed: boolean
}

/** Block a shell command or tool call with an explanation. */
export interface Deny {
  /** Reason shown to the user and agent for rejecting the call. */
  deny: string
}

/** Prompt the user for confirmation before executing a shell command or tool call. */
export interface Ask {
  /** Reason displayed in the confirmation prompt. */
  ask: string
  /** Fallback action when the session is non-interactive and cannot prompt the user. */
  otherwise: 'allow' | 'deny'
}

export type Verdict = Deny | Ask | undefined

export interface Followup {
  /** Short message displayed to the user (for example, as a toast). */
  note?: string
  /** Text appended to the tool result context read by the model. */
  context?: string
}

/** Delivery outcome for a harness notification or injection: immediate, deferred, or dropped. */
export type Delivery = 'now' | 'queued' | 'dropped'

/** Options for {@link Harness.run}. */
export interface RunOptions {
  /** Working directory for the child process. Defaults to the session's current directory. */
  cwd?: string
  /** Maximum runtime in milliseconds before the harness aborts the process. */
  timeoutMs?: number
}

/** Result returned by {@link Harness.run}. */
export interface RunResult {
  /** Process exit code, or `null` if terminated without one. */
  exitCode: number | null
  stdout: string
  stderr: string
}

/** Request passed to {@link Harness.mcp} to invoke a tool on a harness-connected MCP server. */
export interface McpCall {
  /** Server name as listed by the harness (for example, in `/mcp`). */
  server: string
  tool: string
  input?: Readonly<Record<string, unknown>>
}

/**
 * Outcome of an {@link Harness.mcp} call.
 *
 * On success, `text` joins all text content blocks with newlines and `structured` holds the
 * parsed structured payload when the tool declares an output schema. On failure, `reason` holds
 * either the tool's error message or the harness's transport error.
 */
export type McpResult =
  | { isOk: true; text: string; structured?: unknown }
  | { isOk: false; reason: string }

/** Reasoning effort level passed to {@link CompletionRequest.effort}. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Parameters for a standalone model completion via {@link Harness.complete}. */
export interface CompletionRequest {
  /** Model alias (such as `'haiku'`) or full model identifier. */
  model: string
  prompt: string
  system?: string
  /** Maximum output tokens; uses the harness's default when omitted. */
  maxTokens?: number
  /** Reasoning effort; uses the model's default when omitted. */
  effort?: Effort
  /** Maximum duration in milliseconds before aborting the request. */
  timeoutMs?: number
}

/**
 * Outcome of {@link Harness.complete}.
 *
 * When `isAnswered` is `false`, `reason` classifies the failure and `detail` holds the harness's
 * diagnostic message:
 * - `'api-error'`: the provider returned an error or no response.
 * - `'empty-reply'`: the model returned no text content.
 * - `'aborted'`: the request timed out or was cancelled.
 * - `'refused'`: the harness rejected the request (for example, a disallowed model).
 */
export type Completion =
  | { isAnswered: true; text: string }
  | {
      isAnswered: false
      reason: 'api-error' | 'empty-reply' | 'aborted' | 'refused'
      detail: string
    }

/**
 * Outcome of {@link Harness.copy}.
 *
 * When `isCopied` is `false`, `reason` explains why nothing was confirmed written:
 * - `'no-surface'`: no UI surface is attached (for example, a headless session).
 * - `'no-clipboard'`: a surface is attached, but clipboard access is unavailable.
 * - `'unanswered'`: a remote surface did not acknowledge the request (text may still have copied).
 * - `'refused'`: another plugin or harness policy intercepted the clipboard write.
 */
export type Copied =
  | { isCopied: true }
  | { isCopied: false; reason: 'no-surface' | 'no-clipboard' | 'unanswered' | 'refused' }

/** Client UI surface displaying the harness session. */
export type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

/** Harness capabilities exposed to mod components and handlers via `useHarness()`. */
export interface Harness {
  readonly session: { readonly id: string }
  /** Return the session's current working directory (updates if the session changes directory). */
  cwd(): Promise<string>
  /** Return the session's project root (updates across directory or worktree switches). */
  root(): Promise<string>
  /**
   * Read an environment variable, returning `undefined` if unset.
   *
   * `name` must be a string literal so the compiler can statically collect all referenced
   * environment variables at build time.
   */
  env(name: string): Promise<string | undefined>
  /** Execute `argv` directly without a shell. */
  run(argv: readonly string[], options?: RunOptions): Promise<RunResult>
  /** Invoke a tool on an MCP server connected to the harness without prompting the model. */
  mcp(call: McpCall): Promise<McpResult>
  /** Request a standalone completion outside the active conversation transcript. */
  complete(request: CompletionRequest): Promise<Completion>
  /**
   * Copy `text` to the user's clipboard.
   *
   * Targets `options.surface` when provided (such as from a button press), or the first active
   * surface otherwise.
   */
  copy(text: string, options?: { surface?: Surface }): Promise<Copied>
  /** Display a short notification to the user. */
  notify(text: string): Delivery
  /** Append `text` to the conversation context read by the model without starting a new turn. */
  inject(text: string): Promise<Delivery>
  /** Return the current time in milliseconds since the Unix epoch. */
  now(): number
}

export interface Stored {
  value: unknown
}

export interface Store {
  get(key: string): Stored | undefined
  set(key: string, stored: Stored): void
}

/** Execution phase reported in a {@link Failure} when a mod callback or render throws. */
export type Phase =
  | 'render'
  | 'beforeShell'
  | 'afterShell'
  | 'beforeTool'
  | 'afterTool'
  | 'press'
  | 'command'
  | 'close'
  | 'query'

/** Fault captured by the runtime when mod code throws during a {@link Phase}. */
export interface Failure {
  phase: Phase
  error: unknown
}

/**
 * Target-implemented bridge passed to `mount()`, combining {@link Harness}, {@link Store}, and fault
 * reporting.
 */
export interface HarnessAdapter extends Harness {
  readonly store: Store
  /**
   * Report an error thrown by the mod.
   *
   * By the time `report` is called, the runtime has already failed open so the harness can continue.
   */
  report(failure: Failure): void
}
