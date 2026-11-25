import { copy } from '@atuin/modkit-target-node/runtime/clipboard'
import { run } from '@atuin/modkit-target-node/runtime/run'
import type { Servers } from '@atuin/modkit-target-node/runtime/servers'
import type { Failure, HarnessAdapter, Store } from '@atuin/modkit-target/host'

export interface SessionState {
  readonly id: string
  cwd: string
  readonly root: string
  notes: string[]
  context: string[]
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const NO_MODEL = "Codex gives a plugin's MCP server no model to call"

export function harnessFor({
  session,
  servers,
  store,
  report,
}: {
  session: SessionState
  servers: Servers
  store: Store
  report: (failure: Failure) => void
}): HarnessAdapter {
  return {
    session: { id: session.id },
    cwd: async () => session.cwd,
    root: async () => session.root,
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
    store,
    report,
  }
}

export function reporterFor({
  plugin,
  session,
  log,
}: {
  plugin: string
  session: SessionState
  log: (line: string) => void
}): (failure: Failure) => void {
  const told = new Set<string>()
  return ({ phase, error }) => {
    const line = `${plugin}: ${phase} failed: ${messageOf(error)}`
    log(line)
    if (told.has(line)) return
    told.add(line)
    session.notes.push(line)
  }
}
