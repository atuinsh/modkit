import {
  HarnessTools,
  NATIVE,
  type Capabilities,
  type LoweredSupport,
  type NativeSupport,
} from '@atuin/modkit-target/host'

export interface PiCapabilities extends Capabilities {
  readonly status: NativeSupport
  readonly commands: NativeSupport
  readonly panes: NativeSupport
  readonly beforeShell: NativeSupport
  readonly afterShell: NativeSupport
  readonly beforeTool: NativeSupport
  readonly afterTool: NativeSupport
  readonly toolCards: LoweredSupport
}

export const PI_CAPABILITIES: PiCapabilities = {
  status: NATIVE,
  commands: NATIVE,
  panes: NATIVE,
  beforeShell: NATIVE,
  afterShell: NATIVE,
  beforeTool: NATIVE,
  afterTool: NATIVE,
  toolCards: {
    kind: 'lowered',
    why: "pi draws a card's buttons but can't press them, since its transcript rows take no keys",
  },
}

export const PI_TOOLS: HarnessTools = new HarnessTools({
  harness: 'pi',
  shell: 'bash',
  builtin: ['read', 'edit', 'write', 'grep', 'find', 'ls', 'powershell'],
})
