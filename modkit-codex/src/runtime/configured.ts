import * as v from 'valibot'

import { ProcessRunner } from '@atuin/modkit-target-node/runtime/run'
import {
  StringEnvSchema,
  StringListSchema,
  type StdioServer,
} from '@atuin/modkit-target-node/runtime/servers'
import { errorMessage, Result } from '@atuin/modkit-target/host'

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

function parseJson({ name, stdout }: { name: string; stdout: string }): unknown {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`codex mcp get ${name} printed no JSON`, { cause: error })
  }
}

/** Resolver for stdio MCP servers registered in Codex's configuration. */
export class CodexMcpConfig {
  readonly #binary: string

  constructor(binary = 'codex') {
    this.#binary = binary
  }

  /** Query `codex mcp get <name> --json` and parse the resulting stdio transport config. */
  async resolve(name: string): Promise<Result<StdioServer, string>> {
    const stdout = await ProcessRunner.stdout({
      command: this.#binary,
      args: ['mcp', 'get', name, '--json'],
    }).catch((error: unknown) => {
      throw new Error(`codex mcp get ${name} failed: ${errorMessage(error)}`, { cause: error })
    })
    return CodexMcpConfig.#parse({ name, json: parseJson({ name, stdout }) })
  }

  static #parse({ name, json }: { name: string; json: unknown }): Result<StdioServer, string> {
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
}
