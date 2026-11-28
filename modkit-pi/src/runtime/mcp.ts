import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import * as v from 'valibot'

import {
  StringEnvSchema,
  StringListSchema,
  type StdioServer,
} from '@atuin/modkit-target-node/runtime/servers'
import { Result } from '@atuin/modkit-target/host'

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

function findEntry({ config, name }: { config: unknown; name: string }): Entry | undefined {
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

function resolveStdio({
  name,
  entry,
  cwd,
  home,
}: {
  name: string
  entry: Entry
  cwd: string
  home: string
}): Result<StdioServer, string> {
  const { command, args, env, cwd: dir } = entry
  if (typeof command !== 'string') {
    return Result.err(
      `${name} is an HTTP server, whose login is pi's own; a mod reaches stdio servers only`,
    )
  }
  const where = typeof dir === 'string' ? expanded({ path: dir, home }) : undefined
  return Result.ok({
    command: expanded({ path: command, home }),
    args: args.map((arg) => expanded({ path: arg, home })),
    env,
    cwd: where === undefined || isAbsolute(where) ? where : resolve(cwd, where),
  })
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Resolver for pi's agent directory and stdio MCP server configuration. */
export class PiMcpConfig {
  readonly #cwd: string
  readonly #isTrusted: boolean

  constructor({ cwd, isTrusted }: { cwd: string; isTrusted: boolean }) {
    this.#cwd = cwd
    this.#isTrusted = isTrusted
  }

  static agentDir(): string {
    return process.env['PI_CODING_AGENT_DIR'] ?? join(homedir(), '.pi', 'agent')
  }

  resolve(name: string): Result<StdioServer, string> {
    const user = readJson(join(PiMcpConfig.agentDir(), 'mcp.json'))
    const project = this.#isTrusted ? readJson(join(this.#cwd, '.pi', 'mcp.json')) : undefined
    const own = findEntry({ config: user, name })
    const local = findEntry({ config: project, name })
    const entry = local !== undefined && isWhole(local) ? local : own
    if (entry === undefined) return Result.err(`pi's MCP config names no ${name} server`)
    const enabled = local?.enabled ?? entry.enabled
    if (enabled === false) return Result.err(`${name} is turned off in pi's MCP config`)
    return resolveStdio({ name, entry, cwd: this.#cwd, home: homedir() })
  }
}
