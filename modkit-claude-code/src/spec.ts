import { NATIVE, type Capabilities, type NativeSupport } from '@atuin/modkit-target/host'

export interface ClaudeCodeCapabilities extends Capabilities {
  readonly status: NativeSupport
  readonly commands: NativeSupport
  readonly panes: NativeSupport
  readonly beforeShell: NativeSupport
  readonly afterShell: NativeSupport
  readonly beforeTool: NativeSupport
  readonly afterTool: NativeSupport
  readonly toolCards: NativeSupport
}

export const CLAUDE_CODE_CAPABILITIES: ClaudeCodeCapabilities = {
  status: NATIVE,
  commands: NATIVE,
  panes: NATIVE,
  beforeShell: NATIVE,
  afterShell: NATIVE,
  beforeTool: NATIVE,
  afterTool: NATIVE,
  toolCards: NATIVE,
}
