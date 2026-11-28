import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import * as v from 'valibot'

import {
  StringEnvSchema,
  StringListSchema,
  type StdioServer,
} from '@atuin/modkit-target-node/runtime/servers'
import { errorMessage, Result } from '@atuin/modkit-target/host'

// oxlint-disable-next-line typescript/strict-void-return -- promisify has its own overload for execFile
const execFileAsync = promisify(execFile)

async function codexDescribes(name: string): Promise<unknown> {
  const described = await execFileAsync('codex', ['mcp', 'get', name, '--json'], {
    encoding: 'utf8',
  }).catch((error: unknown) => {
    throw new Error(`codex mcp get ${name} failed: ${errorMessage(error)}`, { cause: error })
  })
  try {
    const json: unknown = JSON.parse(described.stdout)
    return json
  } catch (error) {
    throw new Error(`codex mcp get ${name} printed no JSON`, { cause: error })
  }
}

const DescribedSchema = v.object({
  enabled: v.optional(v.unknown()),
  transport: v.object({
    type: v.optional(v.unknown()),
    command: v.optional(v.unknown()),
    args: v.optional(v.unknown()),
    env: v.optional(v.unknown()),
    cwd: v.optional(v.unknown()),
  }),
})

function parseStdioServer({
  name,
  json,
}: {
  name: string
  json: unknown
}): Result<StdioServer, string> {
  const described = v.safeParse(DescribedSchema, json)
  if (!described.success) {
    return Result.err(`Codex described ${name} in a way this mod can't read`)
  }
  const { enabled, transport } = described.output
  if (enabled === false) return Result.err(`${name} is turned off in Codex's config`)
  if (transport.type !== 'stdio') {
    return Result.err(
      `${name} is an HTTP server, whose login is Codex's own; a mod reaches stdio servers only`,
    )
  }
  const { command, args, env, cwd } = transport
  if (typeof command !== 'string') return Result.err(`Codex described ${name} with no command`)
  return Result.ok({
    command,
    args: v.parse(StringListSchema, args),
    env: v.parse(StringEnvSchema, env),
    cwd: typeof cwd === 'string' ? cwd : undefined,
  })
}

export async function configuredServer(name: string): Promise<Result<StdioServer, string>> {
  return parseStdioServer({ name, json: await codexDescribes(name) })
}
