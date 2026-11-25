/**
 * Hand-written ambient declarations for the subset of Claude Code's plugin runtime API called by
 * `@atuin/modkit-claude-code`, plus the virtual modules synthesized by codegen.
 *
 * Claude Code provides the real `claude-code` module and global `h` factory at runtime; accuracy
 * against the engine is verified by `claude plugin validate` and `claude plugin test` on built
 * plugins.
 *
 * @module
 */

declare module 'claude-code' {
  /** Opaque element tree returned by `ui.render` hooks and validated by the host surface. */
  export type RenderNode = unknown

  export interface Atom<T> {
    readonly initial: T
    readonly shape?: string
  }

  export function atom<T>(
    ref: { readonly plugin: string; readonly key: string },
    initial: T,
    options?: { shape: string },
  ): Atom<T>
  export function read<T>($: EngineInterface, atom: Atom<T>): Promise<T>
  export function update<T>($: EngineInterface, atom: Atom<T>, fn: (now: T) => T): Promise<void>

  type Element = (props: never) => RenderNode

  /** Surface-specific UI element tags resolved via `$.ui.resolve(e)`. */
  export interface Elements {
    readonly Box: Element
    readonly Text: Element
    readonly Button: Element
    readonly Markdown: Element
  }

  export interface EngineInterface {
    readonly session: {
      id(): Promise<string>
      cwd(): Promise<string>
      root(): Promise<string>
      append(args: {
        message: { type: 'user'; content: readonly { type: 'text'; text: string }[] }
      }): Promise<{ deny?: string }>
    }
    readonly process: {
      run(
        argv: readonly string[],
        init?: { cwd?: string; timeoutMs?: number },
      ): Promise<{ exitCode: number; stdout: string; stderr: string }>
    }
    readonly env: { get(name: string): Promise<string | undefined> }
    readonly mcp: {
      call(server: string, tool: string, args?: Record<string, unknown>): Promise<McpToolResult>
    }
    readonly model: { complete(request: ModelCompleteRequest): Promise<ModelCompleteResult> }
    readonly clock: { every(ms: number, fn: () => void): () => void }
    readonly command: { register(command: { name: string; description: string }): Promise<unknown> }
    readonly ui: {
      resolve(e: { surface: string }): Elements
      toast(text: string): void
      open(pane: {
        id: string
        title: string
        focus?: boolean
      }): Promise<{ isPlaced: true } | { isPlaced: false; reason: string }>
      close(pane: { id: string }): Promise<void>
      panes(): Promise<readonly { id: string; isShown: boolean }[]>
      copy(args: { text: string; surface?: string }): Promise<UiCopyResult>
    }
  }

  /** Raw MCP `tools/call` response returned by `$.mcp.call()`. */
  export interface McpToolResult {
    content: readonly { type: string; text?: string }[]
    isError: boolean
    /** Parsed structured payload present when the MCP tool declares an output schema. */
    structuredContent?: unknown
  }

  export interface ModelCompleteRequest {
    model: string
    prompt: string
    system?: string
    maxTokens?: number
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    timeoutMs?: number
  }

  /** Resolved outcome of `$.model.complete()`; provider errors resolve to `isAnswered: false`. */
  export type ModelCompleteResult =
    | { isAnswered: true; text: string }
    | { isAnswered: false; reason: 'api-error'; status: number | null; error: string }
    | { isAnswered: false; reason: 'empty-reply' | 'aborted' }

  export type UiCopyResult =
    | { isCopied: true }
    | { isCopied: false; reason: 'no-surface' | 'no-clipboard' | 'unanswered' | 'refused' }

  export interface ToolCheckInput {
    tool: string
    input: unknown
    tool_use_id?: string
    /** Present when an interactive approver can be prompted; `undefined` in headless sessions. */
    approver?: unknown
  }

  export interface ToolCheckResult {
    decision: 'allow' | 'ask' | 'deny'
    reason?: string
  }

  /** Input to `tool.call`: carries the tool's arguments alongside engine envelope fields. */
  export interface ToolCallInput {
    readonly [argument: string]: unknown
    tool: string
    tool_use_id?: string
    consent?: string
    agentId?: string
    requestMeta?: Record<string, string>
    /** Shell command string for `Bash` calls (flattened onto the envelope by the engine). */
    command?: unknown
  }

  export interface ToolCallResult {
    deny?: string
    text?: string
    isError?: true
    context?: readonly string[]
  }

  export interface RenderInput {
    component: string
    requestId: string
    surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'
    props: Readonly<Record<string, unknown>>
  }

  export interface CommandRunInput {
    command: string
    args: string
  }

  export interface CommandRunResult {
    text?: string
  }

  /** Map of Claude Code hook event names to `[input, output]` payload tuples. */
  export interface Events {
    'session.start': [unknown, unknown]
    'turn.complete': [unknown, unknown]
    'tool.check': [ToolCheckInput, ToolCheckResult]
    'tool.call': [ToolCallInput, ToolCallResult]
    'ui.render': [RenderInput, RenderNode]
    'command.run': [CommandRunInput, CommandRunResult]
    'ui.close': [PaneCloseInput, unknown]
  }

  /** Payload for `ui.close`, stating whether the plugin, user (`'person'`), or unload closed it. */
  export interface PaneCloseInput {
    id: string
    origin: { kind: 'plugin' | 'person' | 'unload' }
  }

  export type Hook<K extends keyof Events> = (
    $: EngineInterface,
    e: Events[K][0],
    next: (e: Events[K][0]) => Promise<Events[K][1]>,
  ) => Promise<Events[K][1]>

  export interface Registration<K extends keyof Events> {
    /** Fallback handler invoked if the hook throws or exceeds its execution budget. */
    catch(handler: Hook<K>): void
  }

  export interface On {
    <K extends keyof Events>(event: K, hook: Hook<K>): Registration<K>
    <K extends keyof Events>(
      event: K,
      matcher: Readonly<Record<string, string>>,
      hook: Hook<K>,
    ): Registration<K>
  }

  /** Resolved plugin settings from `plugin.json`'s `userConfig`, with defaults populated. */
  export type PluginOptions = Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >
  export type Register = (on: On, options: PluginOptions) => unknown
}

/** Global element factory provided by Claude Code's plugin runtime for building UI trees. */
declare const h: (
  tag: unknown,
  props: Readonly<Record<string, unknown>> | null,
  ...children: unknown[]
) => unknown

/** Virtual module synthesized by `StateModule.source()` for this mod's Claude Code state atoms. */
declare module 'modkit-claude:state' {
  import type { EngineInterface } from 'claude-code'

  import type { Stored } from '@atuin/modkit-target/host'

  /** Normalized plugin identifier used as the atom and pane namespace. */
  export const plugin: string
  /** Load all persisted state atoms into an in-memory map before mounting. */
  export function load($: EngineInterface): Promise<Map<string, Stored>>
  /** Persist a single state update to its corresponding atom. */
  export function save($: EngineInterface, change: { key: string; stored: Stored }): Promise<void>
  /** Read the view counter atom so Claude Code re-runs the calling `ui.render` hook on updates. */
  export function readView($: EngineInterface): Promise<unknown>
  /** Increment the view counter atom to schedule a UI redraw across active surfaces. */
  export function bumpView($: EngineInterface): Promise<void>
}

/** Virtual module synthesized by `envSource()` exposing literal `$.env.get()` lookups. */
declare module 'modkit-claude:env' {
  import type { EngineInterface } from 'claude-code'

  export function readEnv($: EngineInterface, name: string): Promise<string | undefined>
}
