import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Plugin } from '@opencode/plugin'

import { Servers } from '@atuin/modkit-target-node/runtime/servers'
import { SettingsSchema } from '@atuin/modkit-target-node/runtime/settings'

import {
  contractOf,
  parseCloseInput,
  parsePressInput,
  parseRunInput,
  parseSessionInput,
  type ViewJson,
} from '../contract.ts'
import { hookCalls } from './calls.ts'
import { opencodeServerOf } from './mcp.ts'
import type { Served } from './served.ts'
import { Sessions, sessionsDirOf } from './sessions.ts'

export type { Served } from './served.ts'

const RUN_ENDS = new Set([
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
])

const dataDir = (): string => process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share')

async function followEvents({
  ctx,
  sessions,
  signal,
}: {
  ctx: Plugin.Context
  sessions: Sessions
  signal: AbortSignal
}): Promise<void> {
  for await (const event of ctx.event.subscribe()) {
    if (signal.aborted) return
    const id = parseSessionInput(event.data)?.sessionID ?? ''
    // A session mounts the mod, and tells it the session started, the first time it is seen.
    if (id !== '' && event.type === 'session.created') void sessions.live(id)
    if (id !== '' && RUN_ENDS.has(event.type)) void endTurn({ sessions, id })
  }
}

async function endTurn({ sessions, id }: { sessions: Sessions; id: string }): Promise<void> {
  const live = await sessions.live(id)
  live?.runtime.endTurn()
}

const NO_VIEW: ViewJson = { statuses: [], panes: [], commands: [] }

interface Handlers {
  view: (input: unknown) => Promise<ViewJson>
  press: (input: unknown) => Promise<object>
  run: (input: unknown) => Promise<object>
  close: (input: unknown) => Promise<object>
}

const handlersOf = (sessions: Sessions): Handlers => ({
  view: async (input) => {
    const req = parseSessionInput(input)
    if (req === undefined) return NO_VIEW
    const live = await sessions.live(req.sessionID)
    return live?.runtime.drawn().json ?? NO_VIEW
  },
  press: async (input) => {
    const req = parsePressInput(input)
    if (req === undefined) return {}
    const live = await sessions.live(req.sessionID)
    live?.runtime.pressed(live.session, req.button)
    return {}
  },
  run: async (input) => {
    const req = parseRunInput(input)
    if (req === undefined) return {}
    const live = await sessions.live(req.sessionID)
    const said = await live?.runtime.run(live.session, req.command)
    return said === undefined || said === '' ? {} : { text: said }
  },
  close: async (input) => {
    const req = parseCloseInput(input)
    if (req === undefined) return {}
    const live = await sessions.live(req.sessionID)
    await live?.runtime.close(live.session, req.pane)
    return {}
  },
})

async function serversOf(ctx: Plugin.Context): Promise<Servers> {
  let configured: readonly (readonly [string, unknown])[] = []
  await ctx.mcp.transform((editor) => {
    configured = editor.list()
  })
  return new Servers({ find: async (name) => opencodeServerOf({ name, configured }) })
}

class RpcOutEvent extends Event {
  readonly kind: 'changed' | 'notified'
  readonly data: Record<string, string>

  constructor({ kind, data }: { kind: 'changed' | 'notified'; data: Record<string, string> }) {
    super('rpc')
    this.kind = kind
    this.data = data
  }
}

function sessionsOf({
  ctx,
  served,
  servers,
  events,
}: {
  ctx: Plugin.Context
  served: Served
  servers: Servers
  events: EventTarget
}): Sessions {
  const { plugin } = served
  const where = `${plugin}'s options in opencode.json`
  const settings = SettingsSchema.from(served.settings).parse(ctx.options, where)
  return new Sessions({
    mod: served.mod,
    images: served.images,
    options: settings.isOk ? settings.options : undefined,
    problems: settings.problems.map((problem) => `${plugin}: ${problem}`),
    ports: {
      reached: { ctx, plugin, cwd: ctx.location.directory, servers },
      dir: sessionsDirOf({ data: dataDir(), plugin }),
      tags: served.state,
      changed: (id) => {
        events.dispatchEvent(new RpcOutEvent({ kind: 'changed', data: { sessionID: id } }))
      },
      notified: ({ id, text }) => {
        events.dispatchEvent(new RpcOutEvent({ kind: 'notified', data: { sessionID: id, text } }))
      },
    },
  })
}

async function setUp({
  ctx,
  served,
}: {
  ctx: Plugin.Context
  served: Served
}): Promise<() => void> {
  const servers = await serversOf(ctx)
  const events = new EventTarget()
  const sessions = sessionsOf({ ctx, served, servers, events })
  const registration = await ctx.rpc.register(contractOf(served.plugin), handlersOf(sessions))
  const stop = new AbortController()
  events.addEventListener(
    'rpc',
    (event) => {
      if (event instanceof RpcOutEvent) void registration.events.emit(event.kind, event.data)
    },
    { signal: stop.signal },
  )
  await hookCalls({ ctx, sessions })
  void followEvents({ ctx, sessions, signal: stop.signal })
  return () => {
    stop.abort()
    sessions[Symbol.dispose]()
    servers[Symbol.dispose]()
  }
}

export function createOpencodeServer(served: Served): Plugin.Plugin {
  return { id: `${served.plugin}-mod`, setup: async (ctx) => setUp({ ctx, served }) }
}
