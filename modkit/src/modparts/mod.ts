import * as v from 'valibot'

import type {
  Followup,
  ShellCall,
  ShellResult,
  ToolCall,
  ToolResult,
  ToolRow,
  Verdict,
} from '../harness/types'
import type { ModNode } from '../runtime/element'
import { describe } from '../runtime/schema'

type Awaitable<T> = T | Promise<T>

/** Supported value types for a mod's user-configurable settings. */
export type OptionValue = string | number | boolean | readonly string[]

export type Options = Readonly<Record<string, OptionValue>>

interface CommandOf {
  readonly description: string
  readonly skill?: string
}

export type CommandPart = CommandOf &
  (
    | {
        // oxlint-disable-next-line typescript/no-invalid-void-type -- a command that only reacts returns nothing
        readonly run: () => Awaitable<string | void>
        readonly pane?: never
      }
    | { readonly pane: () => ModNode; readonly run?: never }
  )

type ByTool<H> = Readonly<Record<string, H>> & { readonly Bash?: never }

export interface Parts {
  readonly status?: () => ModNode
  readonly panes?: readonly (() => ModNode)[]
  readonly commands?: Readonly<Record<string, CommandPart>>
  readonly beforeShell?: (call: ShellCall) => Awaitable<Verdict>
  // oxlint-disable-next-line typescript/no-invalid-void-type -- a handler that only reacts returns nothing
  readonly afterShell?: (result: ShellResult) => Awaitable<Followup | void>
  readonly beforeTool?: ByTool<(call: ToolCall) => Awaitable<Verdict>>
  // oxlint-disable-next-line typescript/no-invalid-void-type -- as afterShell
  readonly afterTool?: ByTool<(result: ToolResult) => Awaitable<Followup | void>>
  readonly toolCards?: Readonly<Record<string, (row: ToolRow) => ModNode>>
}

export interface Mod<Settings extends Options> {
  readonly setup: (settings: Settings) => Parts
}

// oxlint-disable-next-line typescript/no-generated-empty-object-type -- a mod with no settings takes none
export function mod<Settings extends Options = Record<never, never>>(
  setup: (settings: Settings) => Parts,
): Mod<Settings> {
  return { setup }
}

const VerdictSchema = v.optional(
  v.union([
    v.object({ deny: v.string() }),
    v.object({ ask: v.string(), otherwise: v.picklist(['allow', 'deny']) }),
  ]),
)

const FollowupSchema = v.optional(
  v.object({
    note: v.optional(v.string()),
    context: v.optional(v.string()),
  }),
)

/**
 * Validate a handler's untyped return value as a {@link Verdict}.
 *
 * @throws {TypeError} If `value` is not `undefined`, `{ deny: string }`, or
 *     `{ ask: string, otherwise: 'allow' | 'deny' }`.
 */
export function verdictOf(value: unknown): Verdict {
  const parsed = v.safeParse(VerdictSchema, value)
  if (parsed.success) return parsed.output
  throw new TypeError(
    `a beforeShell or beforeTool answered ${describe(value)}; it answers undefined, { deny } or { ask, otherwise }`,
  )
}

/**
 * Validate a handler's untyped return value as a {@link Followup}.
 *
 * @throws {TypeError} If `value` is not `undefined` or an object with optional string `note` and
 *     `context`.
 */
export function followupOf(value: unknown): Followup {
  const parsed = v.safeParse(FollowupSchema, value)
  if (!parsed.success) {
    throw new TypeError(
      `an afterShell or afterTool answered ${describe(value)}; it answers undefined or { note?, context? }`,
    )
  }
  const { note, context } = parsed.output ?? {}
  return {
    ...(note !== undefined && { note }),
    ...(context !== undefined && { context }),
  }
}
