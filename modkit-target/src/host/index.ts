/**
 * What a target's runtime builds on: the {@link ModkitTargetRuntime} it extends, the adapter it
 * implements, the nodes it draws, and the payloads a mod's handlers take and return.
 *
 * It is bundled into each target's package and runs inside the harness, so it reaches nothing of
 * Node's.
 *
 * @module
 */

export {
  NOP_COMMAND_HOST,
  NOP_VIEW_HOST,
  NopPaneHost,
  type CommandHost,
  type PaneHost,
  type PaneOpened,
  type PaneOpening,
  type ViewHost,
} from './hosts.ts'
export { McpResponse } from './mcp-response.ts'
export { PaneId } from './pane-id.ts'
export {
  ModkitTargetRuntime,
  type ButtonPress,
  type HookedCall,
  type HookedResult,
  type Repeat,
} from './runtime.ts'
export { asRecord, errorMessage } from './values.ts'
export { failureReporter, ModVerdict, type VerdictOutcome } from './verdict.ts'
export {
  textOf,
  type ButtonNode,
  type CommandView,
  type Failure,
  type HarnessAdapter,
  type Images,
  type ImgNode,
  type MarkdownNode,
  type PaneView,
  type Phase,
  type Png,
  type StackNode,
  type Store,
  type Stored,
  type TextNode,
  type UiNode,
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
