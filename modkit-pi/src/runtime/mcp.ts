import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import * as v from 'valibot'

import {
  StringEnvSchema,
  StringListSchema,
  type StdioServer,
  type Unreachable,
} from '@atuin/modkit-target-node/runtime/servers'

const EntrySchema = v.object({
  command: v.optional(v.unknown()),
  url: v.optional(v.unknown()),
  type: v.optional(v.unknown()),
  enabled: v.optional(v.unknown()),
  args: StringListSchema,
  env: StringEnvSchema,
  cwd: v.optional(v.unknown()),
})

type Entry = v.InferOutput<typeof EntrySchema>

const ConfigSchema = v.object({ mcpServers: v.record(v.string(), v.unknown()) })

function entryOf({ config, name }: { config: unknown; name: string }): Entry | undefined {
  const servers = v.safeParse(ConfigSchema, config)
  if (!servers.success) return undefined
  const entry = v.safeParse(EntrySchema, servers.output.mcpServers[name])
  return entry.success ? entry.output : undefined
}

const isWhole = (entry: Entry): boolean =>
  entry.command !== undefined || entry.url !== undefined || entry.type !== undefined

const HOME = '~/'

const expanded = ({ path, home }: { path: string; home: string }): string =>
  path.startsWith(HOME) ? join(home, path.slice(HOME.length)) : path

function stdioOf({
  name,
  entry,
  cwd,
  home,
}: {
  name: string
  entry: Entry
  cwd: string
  home: string
}): StdioServer | Unreachable {
  const { command, args, env, cwd: dir } = entry
  if (typeof command !== 'string') {
    return {
      reason: `${name} is an HTTP server, whose login is pi's own; a mod reaches stdio servers only`,
    }
  }
  const where = typeof dir === 'string' ? expanded({ path: dir, home }) : undefined
  return {
    command: expanded({ path: command, home }),
    args: args.map((arg) => expanded({ path: arg, home })),
    env,
    cwd: where === undefined || isAbsolute(where) ? where : resolve(cwd, where),
  }
}

function piServerOf({
  name,
  user,
  project,
  cwd,
  home,
}: {
  name: string
  user: unknown
  project: unknown
  cwd: string
  home: string
}): StdioServer | Unreachable {
  const own = entryOf({ config: user, name })
  const local = entryOf({ config: project, name })
  const entry = local !== undefined && isWhole(local) ? local : own
  if (entry === undefined) return { reason: `pi's MCP config names no ${name} server` }
  const enabled = local?.enabled ?? entry.enabled
  if (enabled === false) return { reason: `${name} is turned off in pi's MCP config` }
  return stdioOf({ name, entry, cwd, home })
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export const agentDir = (): string =>
  process.env['PI_CODING_AGENT_DIR'] ?? join(homedir(), '.pi', 'agent')

export function configuredServer({
  name,
  cwd,
  isTrusted,
}: {
  name: string
  cwd: string
  isTrusted: boolean
}): StdioServer | Unreachable {
  return piServerOf({
    name,
    user: readJson(join(agentDir(), 'mcp.json')),
    project: isTrusted ? readJson(join(cwd, '.pi', 'mcp.json')) : undefined,
    cwd,
    home: homedir(),
  })
}
