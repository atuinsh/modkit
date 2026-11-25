/**
 * What a target's runtime builds on: modkit's engine, the adapter it implements, the nodes it draws,
 * and the payloads a mod's handlers take and return.
 *
 * It is bundled into each target's package and runs inside the harness, so it reaches nothing of
 * Node's.
 *
 * @module
 */

export {
  dismissed,
  mount,
  nextShown,
  NOTHING_SHOWN,
  textOf,
  type ButtonNode,
  type CommandView,
  type Failure,
  type HarnessAdapter,
  type MarkdownNode,
  type Mounted,
  type PaneChange,
  type PaneView,
  type Phase,
  type Shown,
  type StackNode,
  type Store,
  type Stored,
  type TextNode,
  type UiNode,
  type View,
} from '@atuin/modkit/host'
export type {
  Ask,
  Border,
  Completion,
  CompletionRequest,
  Copied,
  Delivery,
  Deny,
  Effort,
  Followup,
  Harness,
  Hex,
  McpCall,
  McpResult,
  Mod,
  Options,
  Press,
  RunOptions,
  RunResult,
  ShellCall,
  ShellResult,
  Surface,
  Tone,
  ToolCall,
  ToolResult,
  ToolRow,
  Verdict,
} from '@atuin/modkit'
