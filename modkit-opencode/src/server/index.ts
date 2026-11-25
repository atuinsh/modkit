import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Plugin } from '@opencode/plugin'
import { isPlainObject } from 'es-toolkit/predicate'

import { Servers } from '@atuin/modkit-target-node/runtime/servers'
import { settingsOf } from '@atuin/modkit-target-node/runtime/settings'

import { contractOf, type ViewJson } from '../contract'
import { hookCalls } from './calls'
import { opencodeServerOf } from './mcp'
import type { Served } from './served'
import { Sessions, sessionsDirOf } from './sessions'

export type { Served } from './served'

const RUN_ENDS = new Set([
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
])

function stringIn({ value, key }: { value: unknown; key: string }): string {
  const found: unknown = isPlainObject(value) ? value[key] : undefined
  return typeof found === 'string' ? found : ''
}

const sessionIn = (input: unknown): string => stringIn({ value: input, key: 'sessionID' })

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
    const id = sessionIn(event.data)
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
    const live = await sessions.live(sessionIn(input))
    return live?.runtime.drawn().json ?? NO_VIEW
  },
  press: async (input) => {
    const live = await sessions.live(sessionIn(input))
    live?.runtime.pressed(live.session, stringIn({ value: input, key: 'button' }))
    return {}
  },
  run: async (input) => {
    const live = await sessions.live(sessionIn(input))
    const said = await live?.runtime.run(live.session, stringIn({ value: input, key: 'command' }))
    return said === undefined || said === '' ? {} : { text: said }
  },
  close: async (input) => {
    const live = await sessions.live(sessionIn(input))
    await live?.runtime.close(live.session, stringIn({ value: input, key: 'pane' }))
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

interface Outbox {
  emit?: (event: 'changed' | 'notified', data: Record<string, string>) => Promise<void>
}

function sessionsOf({
  ctx,
  served,
  servers,
  outbox,
}: {
  ctx: Plugin.Context
  served: Served
  servers: Servers
  outbox: Outbox
}): Sessions {
  const { plugin } = served
  const where = `${plugin}'s options in opencode.json`
  const settings = settingsOf({ decls: served.settings, given: ctx.options, where })
  return new Sessions({
    mod: served.mod,
    options: settings.isOk ? settings.options : undefined,
    problems: settings.problems.map((problem) => `${plugin}: ${problem}`),
    ports: {
      reached: { ctx, plugin, cwd: ctx.location.directory, servers },
      dir: sessionsDirOf({ data: dataDir(), plugin }),
      tags: served.state,
      changed: (id) => {
        void outbox.emit?.('changed', { sessionID: id })
      },
      notified: ({ id, text }) => {
        void outbox.emit?.('notified', { sessionID: id, text })
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
  const outbox: Outbox = {}
  const sessions = sessionsOf({ ctx, served, servers, outbox })
  const registration = await ctx.rpc.register(contractOf(served.plugin), handlersOf(sessions))
  outbox.emit = async (event, data) => registration.events.emit(event, data)
  await hookCalls({ ctx, sessions })
  const stop = new AbortController()
  void followEvents({ ctx, sessions, signal: stop.signal })
  return () => {
    stop.abort()
    sessions.dispose()
    servers.close()
  }
}

export function serverOf(served: Served): Plugin.Plugin {
  return { id: `${served.plugin}-mod`, setup: async (ctx) => setUp({ ctx, served }) }
}
