import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import * as v from 'valibot'

import {
  StringEnvSchema,
  StringListSchema,
  type StdioServer,
  type Unreachable,
} from '@atuin/modkit-target-node/runtime/servers'
import { errorMessage } from '@atuin/modkit-target/host'

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
}): StdioServer | Unreachable {
  const described = v.safeParse(DescribedSchema, json)
  if (!described.success) {
    return { reason: `Codex described ${name} in a way this mod can't read` }
  }
  const { enabled, transport } = described.output
  if (enabled === false) return { reason: `${name} is turned off in Codex's config` }
  if (transport.type !== 'stdio') {
    return {
      reason: `${name} is an HTTP server, whose login is Codex's own; a mod reaches stdio servers only`,
    }
  }
  const { command, args, env, cwd } = transport
  if (typeof command !== 'string') return { reason: `Codex described ${name} with no command` }
  return {
    command,
    args: v.parse(StringListSchema, args),
    env: v.parse(StringEnvSchema, env),
    cwd: typeof cwd === 'string' ? cwd : undefined,
  }
}

export async function configuredServer(name: string): Promise<StdioServer | Unreachable> {
  return parseStdioServer({ name, json: await codexDescribes(name) })
}
