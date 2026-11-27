import { copy } from '@atuin/modkit-target-node/runtime/clipboard'
import { projectRootOf, run } from '@atuin/modkit-target-node/runtime/run'
import type { Servers } from '@atuin/modkit-target-node/runtime/servers'
import {
  failureReporter,
  type Failure,
  type HarnessAdapter,
  type Store,
} from '@atuin/modkit-target/host'

export interface SessionState {
  readonly id: string
  cwd: string
  notes: string[]
  context: string[]
}

const NO_MODEL = "Codex gives a plugin's MCP server no model to call"

export function harnessFor({
  plugin,
  session,
  servers,
  storeFor,
  log,
}: {
  plugin: string
  session: SessionState
  servers: Servers
  storeFor: (report: (failure: Failure) => void) => Store
  log: (line: string) => void
}): HarnessAdapter {
  const report = failureReporter({
    plugin,
    notify: (line) => {
      session.notes.push(line)
    },
    log,
  })
  return {
    session: { id: session.id },
    cwd: async () => session.cwd,
    // Codex's hooks name only the session's directory.
    root: async () => projectRootOf(session.cwd),
    env: async (name) => process.env[name],
    run: async (argv, options) => run({ argv, options, cwd: session.cwd }),
    mcp: async (call) => servers.call(call),
    complete: async () => ({ isAnswered: false, reason: 'refused', detail: NO_MODEL }),
    copy: async (text) => copy(text),
    notify: (text) => {
      session.notes.push(text)
      return 'queued'
    },
    inject: async (text) => {
      session.context.push(text)
      return 'queued'
    },
    now: () => Date.now(),
    store: storeFor(report),
    report,
  }
}
